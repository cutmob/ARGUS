package streaming

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/cutmob/argus/internal/session"
	"github.com/cutmob/argus/pkg/types"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024 * 64,
	WriteBufferSize: 1024 * 64,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// Config holds callbacks and dependencies for the WebSocket server.
type Config struct {
	OnFrame        func(sessionID string, frame types.Frame)
	OnAudio        func(sessionID string, chunk types.AudioChunk)
	OnEvent        func(sessionID string, event types.VisionEvent)
	SessionManager *session.Manager
	DemoTokens     map[string]bool // allowed access tokens; nil = no gate
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
func (ws *WebSocketServer) HandleConnection(w http.ResponseWriter, r *http.Request) {
	// Demo token gate — reject connections without a valid token
	if len(ws.cfg.DemoTokens) > 0 {
		token := r.URL.Query().Get("token")
		if !ws.cfg.DemoTokens[token] {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			slog.Warn("rejected connection: invalid demo token", "remote", r.RemoteAddr)
			return
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
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
	data, err := json.Marshal(welcome)
	if err != nil {
		slog.Error("failed to marshal welcome message", "error", err)
	} else {
		client.send <- data
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
		ws.removeClient(c.sessionID)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(1024 * 1024 * 10) // 10MB max message
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
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
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
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
			go ws.cfg.OnFrame(sessionID, frame)
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
			go ws.cfg.OnAudio(sessionID, chunk)
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

	if ws.cfg.OnEvent != nil {
		event := types.VisionEvent{
			Type:      types.EventUserQuery,
			SessionID: sessionID,
			Timestamp: time.Now(),
		}
		ws.cfg.OnEvent(sessionID, event)
	}
}

func (ws *WebSocketServer) removeClient(sessionID string) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if client, ok := ws.clients[sessionID]; ok {
		close(client.done)
		delete(ws.clients, sessionID)
		slog.Info("client disconnected", "session_id", sessionID)
	}
}
