package inspection

import (
	"github.com/cutmob/argus/pkg/types"
)

// HazardDetector evaluates vision results against rules to identify hazards.
// It also computes risk scores for sessions and reports.
type HazardDetector struct {
	ruleEngine *RuleEngine
}

func NewHazardDetector(re *RuleEngine) *HazardDetector {
	return &HazardDetector{ruleEngine: re}
}

// EvaluateObjects checks detected objects against session rules
// and returns potential hazards for Gemini to confirm.
func (hd *HazardDetector) EvaluateObjects(sessionID string, objects []types.DetectedObject) []types.InspectionRule {
	return hd.ruleEngine.MatchRules(sessionID, objects)
}

// CalculateRiskScore computes a numeric risk score from detected hazards.
// Formula: sum(severity_weight * confidence) for all hazards.
func (hd *HazardDetector) CalculateRiskScore(hazards []types.Hazard) float64 {
	if len(hazards) == 0 {
		return 0
	}

	total := 0.0
	for _, h := range hazards {
		weight := h.Severity.Weight()
		confidence := h.Confidence
		if confidence <= 0 {
			confidence = 0.5
		}
		total += weight * confidence
	}
	return total
}

// CalculateRiskLevel converts a set of hazards into an overall severity.
func (hd *HazardDetector) CalculateRiskLevel(hazards []types.Hazard) types.Severity {
	score := hd.CalculateRiskScore(hazards)

	switch {
	case score >= 30:
		return types.SeverityCritical
	case score >= 15:
		return types.SeverityHigh
	case score >= 5:
		return types.SeverityMedium
	default:
		return types.SeverityLow
	}
}

// ShouldAlert returns true if any hazard warrants an immediate voice alert.
func (hd *HazardDetector) ShouldAlert(hazards []types.Hazard) bool {
	for _, h := range hazards {
		if h.Severity == types.SeverityHigh || h.Severity == types.SeverityCritical {
			return true
		}
	}
	return false
}

// PrioritizeHazards sorts hazards by severity (critical first) and returns the top N.
func (hd *HazardDetector) PrioritizeHazards(hazards []types.Hazard, limit int) []types.Hazard {
	if len(hazards) <= limit {
		return hazards
	}

	// Simple priority sort: critical > high > medium > low
	buckets := map[types.Severity][]types.Hazard{
		types.SeverityCritical: {},
		types.SeverityHigh:     {},
		types.SeverityMedium:   {},
		types.SeverityLow:      {},
	}

	for _, h := range hazards {
		buckets[h.Severity] = append(buckets[h.Severity], h)
	}

	var result []types.Hazard
	for _, sev := range []types.Severity{
		types.SeverityCritical,
		types.SeverityHigh,
		types.SeverityMedium,
		types.SeverityLow,
	} {
		for _, h := range buckets[sev] {
			if len(result) >= limit {
				return result
			}
			result = append(result, h)
		}
	}

	return result
}
