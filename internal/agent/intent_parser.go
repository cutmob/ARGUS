package agent

import (
	"strings"

	"github.com/cutmob/argus/pkg/types"
)

// IntentParser extracts structured intents from user speech/text.
// In production, Gemini handles intent extraction via function calling.
// This provides a fallback for common patterns.
type IntentParser struct {
	modeAliases map[string]string
}

func NewIntentParser() *IntentParser {
	return &IntentParser{
		modeAliases: map[string]string{
			"elevator":      "elevator",
			"lift":          "elevator",
			"construction":  "construction",
			"building site": "construction",
			"warehouse":     "warehouse",
			"storage":       "warehouse",
			"facility":      "facility",
			"restaurant":    "restaurant",
			"kitchen":       "restaurant",
			"factory":       "factory",
			"manufacturing": "factory",
			"aircraft":      "aircraft",
			"plane":         "aircraft",
			"oil rig":       "oil_rig",
			"general":       "general",
		},
	}
}

// Parse converts raw text into a structured AgentIntent.
func (ip *IntentParser) Parse(text string) types.AgentIntent {
	lower := strings.ToLower(strings.TrimSpace(text))

	intent := types.AgentIntent{
		RawText:    text,
		Parameters: make(map[string]string),
	}

	switch {
	case ip.matchesAny(lower, "start inspection", "begin inspection", "inspect"):
		intent.Type = types.IntentStartInspection
		intent.Mode = ip.extractMode(lower)

	case ip.matchesAny(lower, "stop inspection", "end inspection", "finish inspection", "done"):
		intent.Type = types.IntentStopInspection

	case ip.matchesAny(lower, "switch to", "change to", "switch mode"):
		intent.Type = types.IntentSwitchMode
		intent.Mode = ip.extractMode(lower)

	case ip.matchesAny(lower, "generate report", "create report", "make report", "export report", "export results"):
		intent.Type = types.IntentGenerateReport
		intent.Format = ip.extractFormat(lower)

	case ip.matchesAny(lower, "send to", "export to", "push to"):
		intent.Type = types.IntentExportReport
		intent.Target = ip.extractTarget(lower)
		intent.Format = ip.extractFormat(lower)

	case ip.matchesAny(lower, "what hazards", "what issues", "what problems", "findings"):
		intent.Type = types.IntentQueryHazards

	case ip.matchesAny(lower, "status", "how's it going", "what's happening", "update"):
		intent.Type = types.IntentQueryStatus

	default:
		intent.Type = types.IntentConversation
	}

	return intent
}

func (ip *IntentParser) matchesAny(text string, patterns ...string) bool {
	for _, p := range patterns {
		if strings.Contains(text, p) {
			return true
		}
	}
	return false
}

func (ip *IntentParser) extractMode(text string) string {
	for alias, mode := range ip.modeAliases {
		if strings.Contains(text, alias) {
			return mode
		}
	}
	return "general"
}

func (ip *IntentParser) extractFormat(text string) string {
	switch {
	case strings.Contains(text, "pdf"):
		return "pdf"
	case strings.Contains(text, "json"):
		return "json"
	case strings.Contains(text, "webhook"):
		return "webhook"
	default:
		return "json"
	}
}

func (ip *IntentParser) extractTarget(text string) string {
	targets := []string{"slack", "email", "webhook", "maintenance", "jira", "notion"}
	for _, t := range targets {
		if strings.Contains(text, t) {
			return t
		}
	}
	return "webhook"
}
