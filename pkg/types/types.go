package types

import "time"

// Frame represents a single captured video frame.
type Frame struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	Data      []byte    `json:"-"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Format    string    `json:"format"` // "jpeg", "png", "raw"
	Timestamp time.Time `json:"timestamp"`
}

// AudioChunk represents a segment of captured audio.
type AudioChunk struct {
	SessionID  string    `json:"session_id"`
	Data       []byte    `json:"-"`
	SampleRate int       `json:"sample_rate"` // Target: 16kHz
	Channels   int       `json:"channels"`
	DurationMs int       `json:"duration_ms"`
	Timestamp  time.Time `json:"timestamp"`
}

// DetectedObject represents an object found by the fast vision layer.
type DetectedObject struct {
	Label      string    `json:"label"`
	Confidence float64   `json:"confidence"`
	BBox       BBox      `json:"bbox"`
	Timestamp  time.Time `json:"timestamp"`
}

// BBox defines a bounding box for visual overlays.
type BBox struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Hazard represents a detected safety issue.
type Hazard struct {
	ID          string    `json:"id"`
	RuleID      string    `json:"rule_id"`
	Description string    `json:"description"`
	Severity    Severity  `json:"severity"`
	Confidence  float64   `json:"confidence"`
	BBox        *BBox     `json:"bbox,omitempty"`
	FrameID     string    `json:"frame_id,omitempty"`
	ImageURL    string    `json:"image_url,omitempty"`
	DetectedAt  time.Time `json:"detected_at"`
}

// Severity levels for hazard classification.
type Severity string

const (
	SeverityLow      Severity = "low"
	SeverityMedium   Severity = "medium"
	SeverityHigh     Severity = "high"
	SeverityCritical Severity = "critical"
)

// SeverityWeight returns the numeric weight for risk scoring.
func (s Severity) Weight() float64 {
	switch s {
	case SeverityLow:
		return 1.0
	case SeverityMedium:
		return 3.0
	case SeverityHigh:
		return 7.0
	case SeverityCritical:
		return 12.0
	default:
		return 0.0
	}
}

// VisionEvent represents a trigger from the event engine.
type VisionEvent struct {
	Type       EventType        `json:"type"`
	SessionID  string           `json:"session_id"`
	Objects    []DetectedObject `json:"objects"`
	Frame      *Frame           `json:"frame,omitempty"`
	Confidence float64          `json:"confidence"`
	Timestamp  time.Time        `json:"timestamp"`
}

type EventType string

const (
	EventHazardCandidate EventType = "hazard_candidate"
	EventNewObject       EventType = "new_object"
	EventSceneChange     EventType = "scene_change"
	EventPeriodicSample  EventType = "periodic_sample"
	EventUserQuery       EventType = "user_query"
)

// InspectionReport holds the complete report data.
type InspectionReport struct {
	ID             string            `json:"id"`
	SessionID      string            `json:"session_id"`
	InspectionMode string            `json:"inspection_mode"`
	Location       string            `json:"location"`
	Inspector      string            `json:"inspector"`
	Hazards        []Hazard          `json:"hazards"`
	RiskLevel      Severity          `json:"risk_level"`
	RiskScore      float64           `json:"risk_score"`
	Summary        string            `json:"summary"`
	Recommendations []string         `json:"recommendations"`
	CreatedAt      time.Time         `json:"created_at"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// AgentIntent represents a parsed user intent from voice/text.
type AgentIntent struct {
	Type       IntentType        `json:"type"`
	Mode       string            `json:"mode,omitempty"`
	Format     string            `json:"format,omitempty"`
	Target     string            `json:"target,omitempty"`
	Parameters map[string]string `json:"parameters,omitempty"`
	RawText    string            `json:"raw_text"`
}

type IntentType string

const (
	IntentStartInspection IntentType = "start_inspection"
	IntentStopInspection  IntentType = "stop_inspection"
	IntentSwitchMode      IntentType = "switch_mode"
	IntentExportReport    IntentType = "export_report"
	IntentQueryStatus     IntentType = "query_status"
	IntentQueryHazards    IntentType = "query_hazards"
	IntentGenerateReport  IntentType = "generate_report"
	IntentConversation    IntentType = "conversation"
)

// GeminiRequest holds data sent to the Gemini reasoning layer.
type GeminiRequest struct {
	SessionID  string           `json:"session_id"`
	Frame      *Frame           `json:"frame,omitempty"`
	Objects    []DetectedObject `json:"objects,omitempty"`
	Rules      []InspectionRule `json:"rules,omitempty"`
	Prompt     string           `json:"prompt"`
	Context    string           `json:"context,omitempty"`
}

// GeminiResponse holds Gemini's analysis result.
type GeminiResponse struct {
	Hazards         []Hazard `json:"hazards,omitempty"`
	TextResponse    string   `json:"text_response"`
	VoiceResponse   string   `json:"voice_response"`
	Confidence      float64  `json:"confidence"`
}

// InspectionRule defines a single rule within a module.
type InspectionRule struct {
	RuleID        string   `json:"rule_id"`
	Description   string   `json:"description"`
	Severity      Severity `json:"severity"`
	VisualSignals []string `json:"visual_signals"`
	Category      string   `json:"category,omitempty"`
	Enabled       bool     `json:"enabled"`
}

// InspectionModule defines the interface for pluggable inspection types.
type InspectionModule struct {
	Name         string           `json:"name"`
	Version      string           `json:"version"`
	Description  string           `json:"description"`
	Industry     string           `json:"industry"`
	Rules        []InspectionRule `json:"rules"`
	SystemPrompt string           `json:"system_prompt"`
	Metadata     ModuleMetadata   `json:"metadata"`
}

// ModuleMetadata holds information about the inspection module.
type ModuleMetadata struct {
	Author      string   `json:"author"`
	Version     string   `json:"version"`
	Tags        []string `json:"tags"`
	RequiredObjects []string `json:"required_objects,omitempty"`
}

// WebSocketMessage is the envelope for all WebSocket communication.
type WebSocketMessage struct {
	Type      string      `json:"type"`
	SessionID string      `json:"session_id"`
	Payload   interface{} `json:"payload"`
	Timestamp time.Time   `json:"timestamp"`
}

// Overlay represents a visual element to render on the client.
type Overlay struct {
	Type     string   `json:"type"` // "hazard_box", "info_label", "risk_zone"
	Label    string   `json:"label"`
	BBox     *BBox    `json:"bbox,omitempty"`
	Severity Severity `json:"severity"`
	Color    string   `json:"color"`
}
