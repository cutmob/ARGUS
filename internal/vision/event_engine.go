package vision

import (
	"time"

	"github.com/cutmob/argus/internal/inspection"
	"github.com/cutmob/argus/pkg/types"
)

// EventEngine determines whether a frame + detected objects warrant
// sending to Gemini for deep reasoning.
// This is the "should I think about this?" layer.
type EventEngine struct {
	hazardDetector *inspection.HazardDetector
	// Track what we've seen per session to detect changes
	lastObjects map[string][]string
}

func NewEventEngine(hd *inspection.HazardDetector) *EventEngine {
	return &EventEngine{
		hazardDetector: hd,
		lastObjects:    make(map[string][]string),
	}
}

// Evaluate checks if the current frame should trigger Gemini analysis.
func (ee *EventEngine) Evaluate(sessionID string, frame types.Frame, objects []types.DetectedObject) []types.VisionEvent {
	var events []types.VisionEvent

	// Rule 1: If objects were detected, check for hazard patterns
	if len(objects) > 0 {
		if ee.hasHazardPattern(objects) {
			events = append(events, types.VisionEvent{
				Type:      types.EventHazardCandidate,
				SessionID: sessionID,
				Objects:   objects,
				Frame:     &frame,
				Timestamp: time.Now(),
			})
		}

		// Rule 2: Check if the scene changed significantly
		if ee.sceneChanged(sessionID, objects) {
			events = append(events, types.VisionEvent{
				Type:      types.EventSceneChange,
				SessionID: sessionID,
				Objects:   objects,
				Frame:     &frame,
				Timestamp: time.Now(),
			})
		}

		ee.updateLastObjects(sessionID, objects)
	}

	// Rule 3: Always send periodic samples even without detections
	// (handled at the sampler level — every sampled frame goes through)
	if len(events) == 0 {
		events = append(events, types.VisionEvent{
			Type:      types.EventPeriodicSample,
			SessionID: sessionID,
			Objects:   objects,
			Frame:     &frame,
			Timestamp: time.Now(),
		})
	}

	return events
}

// hasHazardPattern checks for known dangerous object combinations.
func (ee *EventEngine) hasHazardPattern(objects []types.DetectedObject) bool {
	labels := make(map[string]bool)
	for _, obj := range objects {
		labels[obj.Label] = true
	}

	// Common hazard patterns
	patterns := [][]string{
		{"person", "ladder"},            // Fall risk
		{"person", "forklift"},          // Collision risk
		{"person", "electrical_panel"},  // Electrical risk
		{"exposed_wire"},                // Electrical hazard
		{"fire", "smoke"},               // Fire hazard
		{"crack", "structural_damage"},  // Structural risk
	}

	for _, pattern := range patterns {
		match := true
		for _, label := range pattern {
			if !labels[label] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}

	return false
}

// sceneChanged returns true if the set of detected objects has changed significantly.
func (ee *EventEngine) sceneChanged(sessionID string, objects []types.DetectedObject) bool {
	prev, ok := ee.lastObjects[sessionID]
	if !ok {
		return true // First frame is always "changed"
	}

	current := make(map[string]bool)
	for _, obj := range objects {
		current[obj.Label] = true
	}

	prevSet := make(map[string]bool)
	for _, label := range prev {
		prevSet[label] = true
	}

	// Check for new objects that weren't in previous frame
	for label := range current {
		if !prevSet[label] {
			return true
		}
	}

	// Check for disappeared objects
	for label := range prevSet {
		if !current[label] {
			return true
		}
	}

	return false
}

func (ee *EventEngine) updateLastObjects(sessionID string, objects []types.DetectedObject) {
	labels := make([]string, 0, len(objects))
	for _, obj := range objects {
		labels = append(labels, obj.Label)
	}
	ee.lastObjects[sessionID] = labels
}
