package streaming

import (
	"sync"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// FrameStream manages the video frame ingestion pipeline.
// Frames arrive at camera rate (30fps) but are sampled down for processing.
type FrameStream struct {
	mu        sync.Mutex
	sessionID string
	lastFrame time.Time
	onFrame   func(types.Frame)
}

func NewFrameStream(sessionID string, onFrame func(types.Frame)) *FrameStream {
	return &FrameStream{
		sessionID: sessionID,
		onFrame:   onFrame,
	}
}

// Push accepts a raw frame. The stream forwards it to the processing callback.
func (fs *FrameStream) Push(frame types.Frame) {
	fs.mu.Lock()
	fs.lastFrame = time.Now()
	fs.mu.Unlock()

	if fs.onFrame != nil {
		fs.onFrame(frame)
	}
}

// LastFrameTime returns when the last frame was received.
func (fs *FrameStream) LastFrameTime() time.Time {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	return fs.lastFrame
}
