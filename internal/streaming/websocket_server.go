package streaming

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/cutmob/argus/internal/session"
	"github.com/cutmob/argus/pkg/types"
	"github.com/gorilla/websocket"
)

// newUpgrader creates a WebSocket upgrader that validates the Origin header
// against the CORS_ALLOWED_ORIGIN env var. Falls back to allowing all origins
// in development (when the env var is unset or "*").
func newUpgrader() *websocket.Upgrader {
	return &websocket.Upgrader{
		ReadBufferSize:  1024 * 64,
		WriteBufferSize: 1024 * 64,
		CheckOrigin: func(r *http.Request) bool {
			allowed := os.Getenv("CORS_ALLOWED_ORIGIN")
			if allowed == "*" || allowed == "" {
				return true
			}
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true // non-browser clients
			}
			for _, o := range strings.Split(allowed, ",") {
				if strings.TrimSpace(o) == origin {
					return true
				}
			}
			return false
		},
	}
}

// Config holds callbacks and dependencies for the WebSocket server.
type Config struct {
	OnFrame          func(sessionID string, frame types.Frame)
	OnAudio          func(sessionID string, chunk types.AudioChunk)
	OnAudioStreamEnd func(sessionID string)
	OnEvent          func(sessionID string, event types.VisionEvent)
	OnCommand        func(sessionID string, msg types.WebSocketMessage)
	OnDisconnect     func(sessionID string) // called when the last WS for a session closes
	SessionManager   *session.Manager
	DemoTokens       map[string]bool // allowed access tokens; nil = no gate
}

// WebSocketServer manages real-time bidirectional connections.
type WebSocketServer struct {
	cfg     Config
	mu      sync.RWMutex
	clients map[string]*Client
}

// Client wraps a single WebSocket connection.
type Client struct {
	conn      *websocket.Conn
	sessionID string
	cameraID  string
	send      chan []byte
	done      chan struct{}
}

func NewWebSocketServer(cfg Config) *WebSocketServer {
	return &WebSocketServer{
		cfg:     cfg,
		clients: make(map[string]*Client),
	}
}

// HandleConnection upgrades HTTP to WebSocket and starts read/write pumps.
// Authentication: if DemoTokens are configured, the client must send an "auth"
// message with a valid token as the first text frame after connecting.
// Legacy: tokens passed via ?token= query parameter are still accepted.
func (ws *WebSocketServer) HandleConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := newUpgrader().Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}

	// Authenticate if demo tokens are configured
	if len(ws.cfg.DemoTokens) > 0 {
		token := r.URL.Query().Get("token") // legacy query-param support
		if !ws.cfg.DemoTokens[token] {
			// Require auth frame: {"type":"auth","token":"..."}
			if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
				conn.Close()
				return
			}
			_, data, readErr := conn.ReadMessage()
			if readErr != nil {
				slog.Warn("auth read failed", "remote", r.RemoteAddr, "error", readErr)
				_ = conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "auth required"))
				conn.Close()
				return
			}
			var authMsg struct {
				Type  string `json:"type"`
				Token string `json:"token"`
			}
			if jsonErr := json.Unmarshal(data, &authMsg); jsonErr != nil || authMsg.Type != "auth" || !ws.cfg.DemoTokens[authMsg.Token] {
				slog.Warn("rejected connection: invalid demo token", "remote", r.RemoteAddr)
				_ = conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "unauthorized"))
				conn.Close()
				return
			}
			_ = conn.SetReadDeadline(time.Time{}) // reset after auth
		}
	}

	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		sessionID = generateID()
	}
	cameraID := r.URL.Query().Get("camera_id")
	if cameraID == "" {
		cameraID = "cam_" + sessionID[:8]
	}

	client := &Client{
		conn:      conn,
		sessionID: sessionID,
		cameraID:  cameraID,
		send:      make(chan []byte, 256),
		done:      make(chan struct{}),
	}

	ws.mu.Lock()
	ws.clients[sessionID] = client
	ws.mu.Unlock()

	slog.Info("client connected", "session_id", sessionID)

	// Send session confirmation
	welcome := types.WebSocketMessage{
		Type:      "session_created",
		SessionID: sessionID,
		Timestamp: time.Now(),
	}
	welcomeData, marshalErr := json.Marshal(welcome)
	if marshalErr != nil {
		slog.Error("failed to marshal welcome message", "error", marshalErr)
	} else {
		client.send <- welcomeData
	}

	go ws.readPump(client)
	go ws.writePump(client)
}

// Send pushes a message to a specific session's client.
func (ws *WebSocketServer) Send(sessionID string, msg types.WebSocketMessage) error {
	ws.mu.RLock()
	client, ok := ws.clients[sessionID]
	ws.mu.RUnlock()
	if !ok {
		slog.Warn("send failed — no client in map", "session_id", sessionID, "msg_type", msg.Type)
		return nil
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	select {
	case client.send <- data:
	default:
		slog.Warn("send buffer full, dropping message", "session_id", sessionID)
	}
	return nil
}

// Broadcast sends a message to all connected clients.
func (ws *WebSocketServer) Broadcast(msg types.WebSocketMessage) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	data, err := json.Marshal(msg)
	if err != nil {
		slog.Error("failed to marshal broadcast message", "error", err)
		return
	}
	for _, client := range ws.clients {
		select {
		case client.send <- data:
		default:
		}
	}
}

func (ws *WebSocketServer) readPump(c *Client) {
	defer func() {
		ws.removeClient(c.sessionID, c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(1024 * 1024 * 10) // 10MB max message
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})

	for {
		messageType, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Error("read error", "session_id", c.sessionID, "error", err)
			}
			return
		}

		switch messageType {
		case websocket.BinaryMessage:
			ws.handleBinaryMessage(c.sessionID, c.cameraID, data)
		case websocket.TextMessage:
			ws.handleTextMessage(c.sessionID, data)
		}
	}
}

func (ws *WebSocketServer) writePump(c *Client) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.done:
			return
		}
	}
}

func (ws *WebSocketServer) handleBinaryMessage(sessionID string, cameraID string, data []byte) {
	// Binary messages are either video frames or audio chunks.
	// First byte indicates type: 0x01 = frame, 0x02 = audio
	if len(data) < 2 {
		return
	}

	switch data[0] {
	case 0x01: // Video frame
		frame := types.Frame{
			ID:        generateID(),
			SessionID: sessionID,
			CameraID:  cameraID,
			Data:      data[1:],
			Format:    "jpeg",
			Timestamp: time.Now(),
		}
		if ws.cfg.OnFrame != nil {
			// Call synchronously — the controller's HandleFrame is non-blocking.
			// Spawning uncontrolled goroutines here leaked when sessions ended.
			ws.cfg.OnFrame(sessionID, frame)
		}
	case 0x02: // Audio chunk
		chunk := types.AudioChunk{
			SessionID:  sessionID,
			Data:       data[1:],
			SampleRate: 16000,
			Channels:   1,
			DurationMs: 20,
			Timestamp:  time.Now(),
		}
		if ws.cfg.OnAudio != nil {
			ws.cfg.OnAudio(sessionID, chunk)
		}
	case 0x03: // Audio stream end (mic muted)
		if ws.cfg.OnAudioStreamEnd != nil {
			ws.cfg.OnAudioStreamEnd(sessionID)
		}
	}
}

func (ws *WebSocketServer) handleTextMessage(sessionID string, data []byte) {
	var msg types.WebSocketMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		slog.Warn("invalid text message", "session_id", sessionID, "error", err)
		return
	}
	msg.SessionID = sessionID
	if ws.cfg.OnCommand != nil {
		ws.cfg.OnCommand(sessionID, msg)
	}

	if ws.cfg.OnEvent != nil {
		event := types.VisionEvent{
			Type:      types.EventUserQuery,
			SessionID: sessionID,
			Timestamp: time.Now(),
		}
		ws.cfg.OnEvent(sessionID, event)
	}
}

func (ws *WebSocketServer) removeClient(sessionID string, caller *Client) {
	ws.mu.Lock()
	current, isCurrent := ws.clients[sessionID]
	if isCurrent && current == caller {
		close(caller.done)
		delete(ws.clients, sessionID)
		slog.Info("client disconnected", "session_id", sessionID)
	} else {
		// A newer connection replaced us — just clean up our goroutines
		close(caller.done)
		slog.Debug("stale client cleanup (replaced by newer connection)", "session_id", sessionID)
	}
	ws.mu.Unlock()

	// If this was the active connection (not a stale replacement), tear down
	// the inspection so the Gemini live session stops processing.
	if isCurrent && current == caller && ws.cfg.OnDisconnect != nil {
		ws.cfg.OnDisconnect(sessionID)
	}
}
