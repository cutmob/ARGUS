package gemini

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"google.golang.org/genai"
)

const (
	toolPendingTimeout = 30 * time.Second
)

// nonBlockingTools is the set of tool names declared as NON_BLOCKING.
// Tool calls for these do NOT gate realtimeInput — the model keeps streaming
// audio while they execute in the background.
var nonBlockingTools = map[string]bool{
	"inspect_frame": true,
}

// LiveSession wraps a single Gemini Live API bidirectional streaming session.
type LiveSession struct {
	mu               sync.Mutex
	session          *genai.Session
	sessionID        string
	model            string
	active           bool
	toolPending      bool      // true while a BLOCKING tool call is being processed
	toolPendingSince time.Time // when toolPending was set — used for safety timeout
	turnCount        int       // number of completed model turns

	onText        func(sessionID, text string)
	onAudio       func(sessionID string, data []byte)
	onToolCall    func(sessionID string, calls []*genai.FunctionCall)
	onTranscript  func(sessionID, speaker, text string)
	onInterrupted func(sessionID string)
	onGoAway      func(sessionID, handle string)
	onSessionDead func(sessionID string, reason string)
}

// LiveSessionConfig holds everything needed to start a Live session.
type LiveSessionConfig struct {
	SessionID    string
	SystemPrompt string
	Tools        []*genai.Tool
	OnText         func(sessionID, text string)
	OnAudio        func(sessionID string, data []byte)
	OnToolCall     func(sessionID string, calls []*genai.FunctionCall)
	OnTranscript   func(sessionID, speaker, text string)
	// OnInterrupted is called when VAD detects the user speaking during model
	// output. The client must immediately clear its audio playback queue.
	OnInterrupted  func(sessionID string)
	// OnGoAway is called when the server sends a GoAway signal indicating an
	// imminent disconnection. The handler receives the current resumption handle
	// so the caller can trigger a reconnect with prior temporal state injected.
	OnGoAway       func(sessionID, handle string)
	// OnSessionDead is called when the Gemini session terminates unexpectedly
	// (receive loop error, etc.) so the frontend can be notified.
	OnSessionDead  func(sessionID string, reason string)
}

// NewLiveSession connects to the Gemini Live API and starts the receive loop.
func NewLiveSession(ctx context.Context, client *Client, cfg LiveSessionConfig) (*LiveSession, error) {
	connectConfig := &genai.LiveConnectConfig{
		ResponseModalities: []genai.Modality{genai.ModalityAudio},
		SystemInstruction: &genai.Content{
			Parts: []*genai.Part{genai.NewPartFromText(cfg.SystemPrompt)},
		},
		MediaResolution: genai.MediaResolutionLow,
		SpeechConfig: &genai.SpeechConfig{
			VoiceConfig: &genai.VoiceConfig{
				PrebuiltVoiceConfig: &genai.PrebuiltVoiceConfig{
					VoiceName: "Kore",
				},
			},
		},
		InputAudioTranscription:  &genai.AudioTranscriptionConfig{},
		OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
		// Sliding window compression extends sessions beyond the 2-minute
		// audio+video limit. Without this, sessions silently die.
		ContextWindowCompression: &genai.ContextWindowCompressionConfig{
			SlidingWindow: &genai.SlidingWindow{},
		},
	}

	if len(cfg.Tools) > 0 {
		connectConfig.Tools = cfg.Tools
	}

	session, err := client.LiveInner().Live.Connect(ctx, client.LiveModel(), connectConfig)
	if err != nil {
		return nil, fmt.Errorf("connecting to Gemini Live API: %w", err)
	}

	ls := &LiveSession{
		session:      session,
		sessionID:    cfg.SessionID,
		model:        client.LiveModel(),
		active:       true,
		onText:        cfg.OnText,
		onAudio:       cfg.OnAudio,
		onToolCall:    cfg.OnToolCall,
		onTranscript:  cfg.OnTranscript,
		onInterrupted: cfg.OnInterrupted,
		onGoAway:      cfg.OnGoAway,
		onSessionDead: cfg.OnSessionDead,
	}

	slog.Info("live session connected",
		"session_id", cfg.SessionID,
		"model", client.LiveModel(),
	)

	go ls.receiveLoop(ctx)

	return ls, nil
}

// SendAudio streams a PCM audio chunk to Gemini Live.
// Audio: raw 16-bit PCM, 16kHz, little-endian, mono.
// Returns nil silently when a tool call is pending — the Gemini API rejects
// realtimeInput during pending tool calls (error 1008), so we must gate here.
// Includes a safety timeout: if toolPending has been set for longer than
// toolPendingTimeout, force-clear it to prevent permanent audio deadlock.
func (ls *LiveSession) SendAudio(data []byte) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return fmt.Errorf("session %s is closed", ls.sessionID)
	}
	if ls.toolPending {
		if !ls.toolPendingSince.IsZero() && time.Since(ls.toolPendingSince) > toolPendingTimeout {
			slog.Warn("toolPending safety timeout — force-clearing to resume audio",
				"session_id", ls.sessionID,
				"stuck_for", time.Since(ls.toolPendingSince).String(),
			)
			ls.toolPending = false
		} else {
			return nil // drop audio while tool call is in flight
		}
	}

	err := ls.session.SendRealtimeInput(genai.LiveSendRealtimeInputParameters{
		Audio: &genai.Blob{
			Data:     data,
			MIMEType: "audio/pcm;rate=16000",
		},
	})
	if err != nil {
		slog.Error("SendRealtimeInput audio failed",
			"session_id", ls.sessionID,
			"error", err,
		)
	}
	return err
}

// SendAudioStreamEnd signals to Gemini that the audio stream has paused
// (e.g. microphone muted). Per Gemini docs, this flushes buffered audio
// and should be sent when the stream pauses for >1 second.
// The client can reopen the stream by sending audio again.
func (ls *LiveSession) SendAudioStreamEnd() error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return nil
	}
	// Gate audioStreamEnd while a tool call is pending — the Gemini API rejects
	// ALL sendRealtimeInput calls (including audioStreamEnd) during pending tool
	// calls, triggering a 1008 policy violation that kills the session.
	if ls.toolPending {
		return nil
	}
	slog.Debug("sending audioStreamEnd", "session_id", ls.sessionID)
	return ls.session.SendRealtimeInput(genai.LiveSendRealtimeInputParameters{
		AudioStreamEnd: true,
	})
}

// SendVideoFrame streams a JPEG frame to Gemini Live. Max 1 FPS.
// Gated by toolPending for the same reason as SendAudio — realtimeInput
// is rejected while a tool call is pending.
func (ls *LiveSession) SendVideoFrame(jpegData []byte) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return fmt.Errorf("session %s is closed", ls.sessionID)
	}
	if ls.toolPending {
		if !ls.toolPendingSince.IsZero() && time.Since(ls.toolPendingSince) > toolPendingTimeout {
			slog.Warn("toolPending safety timeout (video) — force-clearing",
				"session_id", ls.sessionID,
			)
			ls.toolPending = false
		} else {
			return nil
		}
	}

	return ls.session.SendRealtimeInput(genai.LiveSendRealtimeInputParameters{
		Video: &genai.Blob{
			Data:     jpegData,
			MIMEType: "image/jpeg",
		},
	})
}

// SendText sends a text turn via SendClientContent with turnComplete=true.
// This triggers the model to generate a response (and potentially call tools),
// which is the documented way to inject programmatic prompts into a Live session.
// Must be gated behind toolPending — SendClientContent during a pending tool
// call causes 1008 session termination.
func (ls *LiveSession) SendText(text string) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return fmt.Errorf("session %s is closed", ls.sessionID)
	}
	if ls.toolPending {
		return nil // drop — can't send client content during pending tool call
	}
	return ls.session.SendClientContent(genai.LiveSendClientContentParameters{
		Turns: []*genai.Content{
			{
				Role:  "user",
				Parts: []*genai.Part{genai.NewPartFromText(text)},
			},
		},
		TurnComplete: genai.Ptr(true),
	})
}

// SetToolPending marks the session as having a pending tool call.
// While pending, SendAudio and SendVideoFrame silently drop input to avoid
// Gemini error 1008 (realtimeInput rejected during pending tool calls).
func (ls *LiveSession) SetToolPending(pending bool) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	ls.toolPending = pending
	if pending {
		ls.toolPendingSince = time.Now()
	} else {
		ls.toolPendingSince = time.Time{}
	}
}

// SendToolResponse sends function call results back to Gemini and clears
// the tool-pending gate so audio/video streaming can resume.
func (ls *LiveSession) SendToolResponse(responses []*genai.FunctionResponse) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return fmt.Errorf("session %s is closed", ls.sessionID)
	}

	err := ls.session.SendToolResponse(genai.LiveSendToolResponseParameters{
		FunctionResponses: responses,
	})
	if err == nil {
		ls.toolPending = false
	}
	return err
}

// Close terminates the Live session. Sends audioStreamEnd first to flush
// any buffered audio on the Gemini side before disconnecting.
func (ls *LiveSession) Close() {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return
	}
	// Best-effort flush — ignore errors since we're closing anyway
	_ = ls.session.SendRealtimeInput(genai.LiveSendRealtimeInputParameters{
		AudioStreamEnd: true,
	})
	ls.active = false
	ls.session.Close()
	slog.Info("live session closed", "session_id", ls.sessionID)
}

// IsActive returns whether the session is still connected.
func (ls *LiveSession) IsActive() bool {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return ls.active
}

func (ls *LiveSession) receiveLoop(ctx context.Context) {
	var exitReason string
	defer func() {
		ls.mu.Lock()
		wasActive := ls.active
		ls.active = false
		ls.mu.Unlock()
		slog.Info("live session receive loop ended", "session_id", ls.sessionID, "reason", exitReason)
		if wasActive {
			// Notify frontend that the session died so it can show status
			if ls.onSessionDead != nil {
				ls.onSessionDead(ls.sessionID, exitReason)
			}
			// Fire GoAway so the controller can attempt a reconnect.
			if ls.onGoAway != nil {
				slog.Warn("live session died unexpectedly, triggering reconnect",
					"session_id", ls.sessionID,
				)
				ls.onGoAway(ls.sessionID, "")
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			exitReason = "context cancelled"
			return
		default:
		}

		msg, err := ls.session.Receive()
		if err != nil {
			exitReason = err.Error()
			slog.Error("live session receive error",
				"session_id", ls.sessionID,
				"error", err,
			)
			return
		}

		if msg == nil {
			continue
		}

		ls.handleServerMessage(msg)
	}
}


func (ls *LiveSession) handleServerMessage(msg *genai.LiveServerMessage) {
	handled := false

	if msg.SetupComplete != nil {
		handled = true
		slog.Info("gemini session setup complete", "session_id", ls.sessionID)
	}

	if msg.ServerContent != nil {
		handled = true
		sc := msg.ServerContent

		// TurnComplete — model finished its response.
		if sc.TurnComplete {
			ls.mu.Lock()
			ls.turnCount++
			turn := ls.turnCount
			ls.mu.Unlock()
			slog.Info("model turn complete",
				"session_id", ls.sessionID,
				"turn_number", turn,
			)
		}

		// Pass interruptions straight through — Gemini handles VAD natively.
		if sc.Interrupted {
			slog.Info("model interrupted by user",
				"session_id", ls.sessionID,
			)
			if ls.onInterrupted != nil {
				ls.onInterrupted(ls.sessionID)
			}
		}

		if sc.InputTranscription != nil && sc.InputTranscription.Text != "" {
			if ls.onTranscript != nil {
				ls.onTranscript(ls.sessionID, "user", sc.InputTranscription.Text)
			}
		}

		if sc.OutputTranscription != nil && sc.OutputTranscription.Text != "" {
			if ls.onTranscript != nil {
				ls.onTranscript(ls.sessionID, "model", sc.OutputTranscription.Text)
			}
		}

		if sc.ModelTurn != nil {
			for _, part := range sc.ModelTurn.Parts {
				if part.Text != "" && ls.onText != nil {
					ls.onText(ls.sessionID, part.Text)
				}
				if part.InlineData != nil && ls.onAudio != nil {
					ls.onAudio(ls.sessionID, part.InlineData.Data)
				}
			}
		}
	}

	if msg.ToolCall != nil {
		handled = true
		slog.Info("tool call received",
			"session_id", ls.sessionID,
			"function_count", len(msg.ToolCall.FunctionCalls),
		)
		if len(msg.ToolCall.FunctionCalls) > 0 {
			for _, fc := range msg.ToolCall.FunctionCalls {
				slog.Info("tool call detail",
					"session_id", ls.sessionID,
					"name", fc.Name,
					"id", fc.ID,
					"non_blocking", nonBlockingTools[fc.Name],
				)
			}
			// Gate realtimeInput for ALL tool calls — even NON_BLOCKING ones.
			// The NON_BLOCKING declaration tells the MODEL to call tools without
			// pausing its own output (more proactive). But on our side, the
			// preview model has bugs where concurrent sendRealtimeInput +
			// sendToolResponse causes 1008 crashes. The ~500ms batch window
			// pause is imperceptible.
			ls.SetToolPending(true)
			if ls.onToolCall != nil {
				ls.onToolCall(ls.sessionID, msg.ToolCall.FunctionCalls)
			}
		}
	}

	if msg.ToolCallCancellation != nil {
		handled = true
		slog.Warn("tool call cancelled by server",
			"session_id", ls.sessionID,
			"ids", msg.ToolCallCancellation.IDs,
		)
		// Clear toolPending since the server cancelled the call
		ls.SetToolPending(false)
	}

	if msg.GoAway != nil {
		handled = true
		slog.Warn("gemini live goaway received",
			"session_id", ls.sessionID,
			"time_left", msg.GoAway.TimeLeft,
		)
		if ls.onGoAway != nil {
			ls.onGoAway(ls.sessionID, "")
		}
	}

	if !handled {
		slog.Warn("unhandled server message type", "session_id", ls.sessionID)
	}
}
