package inspection

import (
	"fmt"
	"sync"

	"github.com/cutmob/argus/pkg/types"
)

// RuleEngine manages active inspection rules per session.
// Rules are loaded from modules and evaluated against vision output.
type RuleEngine struct {
	mu           sync.RWMutex
	moduleLoader *ModuleLoader
	// sessionRules maps session ID to active rules
	sessionRules map[string][]types.InspectionRule
}

func NewRuleEngine(loader *ModuleLoader) *RuleEngine {
	return &RuleEngine{
		moduleLoader: loader,
		sessionRules: make(map[string][]types.InspectionRule),
	}
}

// LoadRules sets the active ruleset for a session.
func (re *RuleEngine) LoadRules(sessionID string, rules []types.InspectionRule) {
	re.mu.Lock()
	defer re.mu.Unlock()

	// Only load enabled rules
	active := make([]types.InspectionRule, 0)
	for _, r := range rules {
		if r.Enabled {
			active = append(active, r)
		}
	}
	re.sessionRules[sessionID] = active
}

// GetRules returns the active rules for a session.
func (re *RuleEngine) GetRules(sessionID string) []types.InspectionRule {
	re.mu.RLock()
	defer re.mu.RUnlock()
	rules, ok := re.sessionRules[sessionID]
	if !ok {
		return nil
	}
	result := make([]types.InspectionRule, len(rules))
	copy(result, rules)
	return result
}

// GetRulesByCategory returns rules filtered by category.
func (re *RuleEngine) GetRulesByCategory(sessionID string, category string) []types.InspectionRule {
	re.mu.RLock()
	defer re.mu.RUnlock()

	var result []types.InspectionRule
	for _, r := range re.sessionRules[sessionID] {
		if r.Category == category {
			result = append(result, r)
		}
	}
	return result
}

// GetRulesBySeverity returns rules at or above the given severity.
func (re *RuleEngine) GetRulesBySeverity(sessionID string, minSeverity types.Severity) []types.InspectionRule {
	re.mu.RLock()
	defer re.mu.RUnlock()

	minWeight := minSeverity.Weight()
	var result []types.InspectionRule
	for _, r := range re.sessionRules[sessionID] {
		if r.Severity.Weight() >= minWeight {
			result = append(result, r)
		}
	}
	return result
}

// MatchRules finds rules whose visual signals match the given detected objects.
func (re *RuleEngine) MatchRules(sessionID string, objects []types.DetectedObject) []types.InspectionRule {
	re.mu.RLock()
	defer re.mu.RUnlock()

	objectLabels := make(map[string]bool)
	for _, obj := range objects {
		objectLabels[obj.Label] = true
	}

	var matched []types.InspectionRule
	for _, rule := range re.sessionRules[sessionID] {
		for _, signal := range rule.VisualSignals {
			if objectLabels[signal] {
				matched = append(matched, rule)
				break
			}
		}
	}
	return matched
}

// BuildPromptContext generates a text representation of rules for Gemini prompts.
func (re *RuleEngine) BuildPromptContext(sessionID string) string {
	rules := re.GetRules(sessionID)
	if len(rules) == 0 {
		return "No specific inspection rules loaded."
	}

	ctx := "Active inspection rules:\n"
	for i, r := range rules {
		ctx += "\n" + itoa(i+1) + ". [" + string(r.Severity) + "] " + r.Description
		if len(r.VisualSignals) > 0 {
			ctx += " (look for: " + joinStrings(r.VisualSignals) + ")"
		}
	}
	return ctx
}

// ClearSession removes rules for a closed session.
func (re *RuleEngine) ClearSession(sessionID string) {
	re.mu.Lock()
	defer re.mu.Unlock()
	delete(re.sessionRules, sessionID)
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

func joinStrings(s []string) string {
	result := ""
	for i, v := range s {
		if i > 0 {
			result += ", "
		}
		result += v
	}
	return result
}
