package agent

import (
	"github.com/cutmob/argus/pkg/types"
)

// AgentResponse wraps the agent's output to the client.
type AgentResponse struct {
	Type      string             `json:"type"` // "voice", "overlay", "report", "audio", "error"
	Text      string             `json:"text"`
	Voice     string             `json:"voice,omitempty"`
	AudioData []byte             `json:"audio_data,omitempty"` // Raw PCM audio from Gemini (24kHz)
	Overlays  []types.Overlay    `json:"overlays,omitempty"`
	ReportID  string             `json:"report_id,omitempty"`
	Hazards   []types.Hazard     `json:"hazards,omitempty"`
	Actions   []types.ActionCard `json:"actions,omitempty"`
}

// ResponseManager constructs agent responses for the client.
type ResponseManager struct{}

func NewResponseManager() *ResponseManager {
	return &ResponseManager{}
}

// Voice creates a voice response.
func (rm *ResponseManager) Voice(text string) *AgentResponse {
	return &AgentResponse{
		Type:  "voice",
		Text:  text,
		Voice: text,
	}
}

// HazardAlert creates a proactive hazard alert with overlays.
func (rm *ResponseManager) HazardAlert(text string, hazards []types.Hazard) *AgentResponse {
	overlays := make([]types.Overlay, 0, len(hazards))
	for _, h := range hazards {
		color := "#ffcc00"
		switch h.Severity {
		case types.SeverityHigh:
			color = "#ff4444"
		case types.SeverityCritical:
			color = "#ff0000"
		case types.SeverityMedium:
			color = "#ffaa00"
		}

		overlay := types.Overlay{
			Type:     "hazard_box",
			Label:    h.Description,
			BBox:     h.BBox,
			Severity: h.Severity,
			Color:    color,
		}
		overlays = append(overlays, overlay)
	}

	return &AgentResponse{
		Type:     "voice",
		Text:     text,
		Voice:    text,
		Overlays: overlays,
		Hazards:  hazards,
	}
}

// Conversation creates a generic conversational response.
func (rm *ResponseManager) Conversation(text string) *AgentResponse {
	return &AgentResponse{
		Type: "voice",
		Text: text,
	}
}

// Error creates an error response.
func (rm *ResponseManager) Error(text string) *AgentResponse {
	return &AgentResponse{
		Type: "error",
		Text: text,
	}
}

// ReportReady notifies the client a report is available.
func (rm *ResponseManager) ReportReady(reportID string, summary string) *AgentResponse {
	return &AgentResponse{
		Type:     "report",
		Text:     summary,
		Voice:    summary,
		ReportID: reportID,
	}
}

func (rm *ResponseManager) OperatorActions(text string, actions []types.ActionCard) *AgentResponse {
	return &AgentResponse{
		Type:    "voice",
		Text:    text,
		Voice:   text,
		Actions: actions,
	}
}
