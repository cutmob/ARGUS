package session

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
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
		CameraID:       cfg.CameraID,
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
		now := time.Now()
		hazard.DetectedAt = now
		if hazard.FirstSeenAt.IsZero() {
			hazard.FirstSeenAt = now
		}
		if hazard.LastSeenAt.IsZero() {
			hazard.LastSeenAt = now
		}
		if hazard.Occurrences == 0 {
			hazard.Occurrences = 1
		}

		if idx := findMatchingHazardIndex(s.Hazards, hazard); idx >= 0 {
			existing := &s.Hazards[idx]
			existing.LastSeenAt = now
			existing.DetectedAt = now
			existing.Occurrences++
			if existing.FirstSeenAt.IsZero() {
				existing.FirstSeenAt = now
			}
			existing.PersistenceSeconds = int(now.Sub(existing.FirstSeenAt).Seconds())
			if hazard.Confidence > existing.Confidence {
				existing.Confidence = hazard.Confidence
			}
			if severityRank(hazard.Severity) > severityRank(existing.Severity) {
				existing.Severity = hazard.Severity
				existing.RiskTrend = "rising"
			} else if severityRank(hazard.Severity) < severityRank(existing.Severity) {
				existing.RiskTrend = "falling"
			} else {
				existing.RiskTrend = "stable"
			}
			if hazard.RuleID != "" {
				existing.RuleID = hazard.RuleID
			}
			if hazard.CameraID != "" {
				existing.CameraID = hazard.CameraID
			}
			if hazard.Location != "" {
				existing.Location = hazard.Location
			}
			if hazard.BBox != nil {
				existing.BBox = hazard.BBox
			}
		} else {
			hazard.PersistenceSeconds = int(now.Sub(hazard.FirstSeenAt).Seconds())
			hazard.RiskTrend = "new"
			s.Hazards = append(s.Hazards, hazard)
		}
		s.UpdatedAt = time.Now()
	}
}

func findMatchingHazardIndex(hazards []types.Hazard, target types.Hazard) int {
	sig := hazardSignature(target)
	for i := range hazards {
		if hazardSignature(hazards[i]) == sig {
			return i
		}
	}
	return -1
}

func hazardSignature(h types.Hazard) string {
	key := strings.ToLower(strings.TrimSpace(h.Description))
	return strings.Join([]string{h.RuleID, h.CameraID, key}, "|")
}

func severityRank(s types.Severity) int {
	switch s {
	case types.SeverityLow:
		return 1
	case types.SeverityMedium:
		return 2
	case types.SeverityHigh:
		return 3
	case types.SeverityCritical:
		return 4
	default:
		return 0
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
