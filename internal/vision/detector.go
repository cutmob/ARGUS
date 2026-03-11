package vision

import (
	"log/slog"

	"github.com/cutmob/argus/pkg/types"
)

// Detector is the top-level vision pipeline coordinator.
// It ties together frame sampling, object detection, and event triggering.
type Detector struct {
	sampler     *FrameSampler
	eventEngine *EventEngine
}

func NewDetector(sampler *FrameSampler, eventEngine *EventEngine) *Detector {
	return &Detector{
		sampler:     sampler,
		eventEngine: eventEngine,
	}
}

// ProcessFrame runs the full vision pipeline on an incoming frame.
// Returns any triggered events that require Gemini reasoning.
func (d *Detector) ProcessFrame(sessionID string, frame types.Frame) []types.VisionEvent {
	// Step 1: Check if this frame should be sampled
	if !d.sampler.ShouldSample(sessionID) {
		return nil
	}
	d.sampler.MarkSampled(sessionID)

	// Step 2: Run fast local object detection
	// In production this calls YOLO or similar. For now, the frame
	// is passed directly to the event engine which will forward to Gemini.
	objects := d.detectObjects(frame)

	// Step 3: Evaluate events based on detected objects
	events := d.eventEngine.Evaluate(sessionID, frame, objects)

	if len(events) > 0 {
		slog.Debug("vision events triggered",
			"session_id", sessionID,
			"event_count", len(events),
			"object_count", len(objects),
		)
	}

	return events
}

// detectObjects runs fast local detection on a frame.
// This is the integration point for YOLO/ONNX/TensorRT models.
// Currently returns nil — all vision reasoning is handled by Gemini Live API
// which receives frames directly via SendVideoFrame. When a local detector
// (e.g. YOLO via ONNX runtime) is added, it will pre-filter frames and
// provide object hints to improve Gemini's analysis speed and accuracy.
func (d *Detector) detectObjects(frame types.Frame) []types.DetectedObject {
	return nil
}
