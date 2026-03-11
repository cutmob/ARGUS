package session

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// Manager handles all active inspection sessions.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// Create initializes a new inspection session.
func (m *Manager) Create(cfg SessionConfig) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	s := &Session{
		ID:             cfg.SessionID,
		InspectionMode: cfg.InspectionMode,
		ActiveRuleset:  cfg.RulesetID,
		State:          StateActive,
		Hazards:        make([]types.Hazard, 0),
		FrameBuffer:    NewFrameBuffer(cfg.BufferSize),
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		Metadata:       cfg.Metadata,
	}

	m.sessions[s.ID] = s
	slog.Info("session created", "id", s.ID, "mode", s.InspectionMode)
	return s
}

// Get returns a session by ID.
func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	return s, ok
}

// Close terminates a session and finalizes its state.
func (m *Manager) Close(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[id]
	if !ok {
		return nil, false
	}
	s.State = StateClosed
	s.ClosedAt = time.Now()
	slog.Info("session closed", "id", id, "hazards_found", len(s.Hazards))
	return s, true
}

// CloseAll terminates all active sessions.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, s := range m.sessions {
		s.State = StateClosed
		s.ClosedAt = time.Now()
		slog.Info("session closed", "id", id)
	}
}

// List returns all sessions.
func (m *Manager) List() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		result = append(result, s)
	}
	return result
}

// AddHazard records a detected hazard in the session.
func (m *Manager) AddHazard(sessionID string, hazard types.Hazard) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[sessionID]; ok {
		hazard.DetectedAt = time.Now()
		s.Hazards = append(s.Hazards, hazard)
		s.UpdatedAt = time.Now()
	}
}

// HTTP Handlers

func (m *Manager) HandleListSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sessions := m.List()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions": sessions,
		"count":    len(sessions),
	})
}

func (m *Manager) HandleGetSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Extract session ID from path: /api/v1/sessions/{id}
	id := r.URL.Path[len("/api/v1/sessions/"):]
	s, ok := m.Get(id)
	if !ok {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s)
}
