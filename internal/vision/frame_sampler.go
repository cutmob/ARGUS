package vision

import (
	"sync"
	"time"
)

// FrameSampler controls the rate at which frames are forwarded for analysis.
// Camera sends 30fps but we only need to analyze every few seconds.
type FrameSampler struct {
	mu         sync.Mutex
	intervalMs int
	lastSample map[string]time.Time
}

func NewFrameSampler(intervalMs int) *FrameSampler {
	if intervalMs <= 0 {
		intervalMs = 3000 // Default: sample every 3 seconds
	}
	return &FrameSampler{
		intervalMs: intervalMs,
		lastSample: make(map[string]time.Time),
	}
}

// ShouldSample returns true if enough time has elapsed since the last sample for this session.
func (fs *FrameSampler) ShouldSample(sessionID string) bool {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	last, ok := fs.lastSample[sessionID]
	if !ok {
		return true
	}
	return time.Since(last) >= time.Duration(fs.intervalMs)*time.Millisecond
}

// MarkSampled records that a frame was just sampled.
func (fs *FrameSampler) MarkSampled(sessionID string) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	fs.lastSample[sessionID] = time.Now()
}

// SetInterval updates the sampling interval.
func (fs *FrameSampler) SetInterval(ms int) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	fs.intervalMs = ms
}

// ForceSample resets the timer so the next frame will be sampled.
func (fs *FrameSampler) ForceSample(sessionID string) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	delete(fs.lastSample, sessionID)
}

// Cleanup removes stale session entries older than the given duration.
func (fs *FrameSampler) Cleanup(maxAge time.Duration) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	cutoff := time.Now().Add(-maxAge)
	for id, t := range fs.lastSample {
		if t.Before(cutoff) {
			delete(fs.lastSample, id)
		}
	}
}
