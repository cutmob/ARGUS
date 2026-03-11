package session

import (
	"sync"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

type SessionState string

const (
	StateActive  SessionState = "active"
	StatePaused  SessionState = "paused"
	StateClosed  SessionState = "closed"
)

// Session represents a single inspection session.
type Session struct {
	ID             string            `json:"id"`
	InspectionMode string            `json:"inspection_mode"`
	ActiveRuleset  string            `json:"active_ruleset"`
	State          SessionState      `json:"state"`
	Hazards        []types.Hazard    `json:"hazards"`
	FrameBuffer    *FrameBuffer      `json:"-"`
	RiskScore      float64           `json:"risk_score"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
	ClosedAt       time.Time         `json:"closed_at,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// SessionConfig holds parameters for creating a new session.
type SessionConfig struct {
	SessionID      string
	InspectionMode string
	RulesetID      string
	BufferSize     int
	Metadata       map[string]string
}

// FrameBuffer holds a rolling window of recent frames for temporal reasoning.
type FrameBuffer struct {
	mu     sync.Mutex
	frames []types.Frame
	maxLen int
}

func NewFrameBuffer(maxLen int) *FrameBuffer {
	if maxLen <= 0 {
		maxLen = 30 // ~5 seconds at 6 fps sampling
	}
	return &FrameBuffer{
		frames: make([]types.Frame, 0, maxLen),
		maxLen: maxLen,
	}
}

// Push adds a frame to the buffer, evicting the oldest if full.
func (fb *FrameBuffer) Push(f types.Frame) {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	if len(fb.frames) >= fb.maxLen {
		fb.frames = fb.frames[1:]
	}
	fb.frames = append(fb.frames, f)
}

// Recent returns the last n frames.
func (fb *FrameBuffer) Recent(n int) []types.Frame {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	if n > len(fb.frames) {
		n = len(fb.frames)
	}
	result := make([]types.Frame, n)
	copy(result, fb.frames[len(fb.frames)-n:])
	return result
}

// Len returns the current number of buffered frames.
func (fb *FrameBuffer) Len() int {
	fb.mu.Lock()
	defer fb.mu.Unlock()
	return len(fb.frames)
}
