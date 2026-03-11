package gemini

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"google.golang.org/genai"
)

// LiveSession wraps a single Gemini Live API bidirectional streaming session.
type LiveSession struct {
	mu            sync.Mutex
	session       *genai.Session
	sessionID     string
	model         string
	active        bool
	onText        func(sessionID, text string)
	onAudio       func(sessionID string, data []byte)
	onToolCall    func(sessionID string, calls []*genai.FunctionCall)
	onTranscript  func(sessionID, speaker, text string)
}

// LiveSessionConfig holds everything needed to start a Live session.
type LiveSessionConfig struct {
	SessionID      string
	SystemPrompt   string
	Tools          []*genai.Tool
	OnText         func(sessionID, text string)
	OnAudio        func(sessionID string, data []byte)
	OnToolCall     func(sessionID string, calls []*genai.FunctionCall)
	OnTranscript   func(sessionID, speaker, text string)
}

// NewLiveSession connects to the Gemini Live API and starts the receive loop.
func NewLiveSession(ctx context.Context, client *Client, cfg LiveSessionConfig) (*LiveSession, error) {
	connectConfig := &genai.LiveConnectConfig{
		ResponseModalities: []genai.Modality{genai.ModalityAudio, genai.ModalityText},
		SystemInstruction: &genai.Content{
			Parts: []*genai.Part{genai.NewPartFromText(cfg.SystemPrompt)},
		},
		InputAudioTranscription:  &genai.AudioTranscriptionConfig{},
		OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
		RealtimeInputConfig: &genai.RealtimeInputConfig{
			AutomaticActivityDetection: &genai.AutomaticActivityDetection{
				Disabled: false,
			},
			ActivityHandling: genai.ActivityHandlingStartOfActivityInterrupts,
			TurnCoverage:     genai.TurnCoverageTurnIncludesOnlyActivity,
		},
	}

	if len(cfg.Tools) > 0 {
		connectConfig.Tools = cfg.Tools
	}

	session, err := client.Inner().Live.Connect(ctx, client.LiveModel(), connectConfig)
	if err != nil {
		return nil, fmt.Errorf("connecting to Gemini Live API: %w", err)
	}

	ls := &LiveSession{
		session:      session,
		sessionID:    cfg.SessionID,
		model:        client.LiveModel(),
		active:       true,
		onText:       cfg.OnText,
		onAudio:      cfg.OnAudio,
		onToolCall:   cfg.OnToolCall,
		onTranscript: cfg.OnTranscript,
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
func (ls *LiveSession) SendAudio(data []byte) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return fmt.Errorf("session %s is closed", ls.sessionID)
	}

	return ls.session.SendRealtimeInput(genai.LiveSendRealtimeInputParameters{
		Audio: &genai.Blob{
			Data:     data,
			MIMEType: "audio/pcm;rate=16000",
		},
	})
}

// SendVideoFrame streams a JPEG frame to Gemini Live. Max 1 FPS.
func (ls *LiveSession) SendVideoFrame(jpegData []byte) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return fmt.Errorf("session %s is closed", ls.sessionID)
	}

	return ls.session.SendRealtimeInput(genai.LiveSendRealtimeInputParameters{
		Video: &genai.Blob{
			Data:     jpegData,
			MIMEType: "image/jpeg",
		},
	})
}

// SendText sends a text message into the live conversation.
func (ls *LiveSession) SendText(text string) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return fmt.Errorf("session %s is closed", ls.sessionID)
	}

	return ls.session.SendClientContent(genai.LiveSendClientContentParameters{
		Turns: []*genai.Content{
			{
				Role:  genai.RoleUser,
				Parts: []*genai.Part{genai.NewPartFromText(text)},
			},
		},
		TurnComplete: genai.Ptr(true),
	})
}

// SendToolResponse sends function call results back to Gemini.
func (ls *LiveSession) SendToolResponse(responses []*genai.FunctionResponse) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return fmt.Errorf("session %s is closed", ls.sessionID)
	}

	return ls.session.SendToolResponse(genai.LiveSendToolResponseParameters{
		FunctionResponses: responses,
	})
}

// Close terminates the Live session.
func (ls *LiveSession) Close() {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if !ls.active {
		return
	}
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
	defer func() {
		ls.mu.Lock()
		ls.active = false
		ls.mu.Unlock()
		slog.Info("live session receive loop ended", "session_id", ls.sessionID)
	}()

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		msg, err := ls.session.Receive()
		if err != nil {
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
	if msg.ServerContent != nil {
		sc := msg.ServerContent

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

	if msg.ToolCall != nil && len(msg.ToolCall.FunctionCalls) > 0 {
		if ls.onToolCall != nil {
			ls.onToolCall(ls.sessionID, msg.ToolCall.FunctionCalls)
		}
	}

	if msg.GoAway != nil {
		slog.Warn("gemini live goaway received",
			"session_id", ls.sessionID,
			"time_left", msg.GoAway.TimeLeft,
		)
	}
}
