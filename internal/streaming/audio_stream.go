package streaming

import (
	"sync"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// AudioStream manages the real-time audio pipeline.
// Audio must be resampled to 16kHz mono before sending to Gemini.
type AudioStream struct {
	mu         sync.Mutex
	sessionID  string
	sampleRate int
	chunkSize  int // target 20-40ms chunks
	buffer     []byte
	onChunk    func(types.AudioChunk)
}

func NewAudioStream(sessionID string, onChunk func(types.AudioChunk)) *AudioStream {
	return &AudioStream{
		sessionID:  sessionID,
		sampleRate: 16000,
		chunkSize:  640, // 20ms at 16kHz mono 16-bit
		buffer:     make([]byte, 0),
		onChunk:    onChunk,
	}
}

// Write accepts raw audio bytes and emits properly sized chunks.
func (as *AudioStream) Write(data []byte) {
	as.mu.Lock()
	defer as.mu.Unlock()

	as.buffer = append(as.buffer, data...)

	for len(as.buffer) >= as.chunkSize {
		chunk := types.AudioChunk{
			SessionID:  as.sessionID,
			Data:       as.buffer[:as.chunkSize],
			SampleRate: as.sampleRate,
			Channels:   1,
			DurationMs: 20,
			Timestamp:  time.Now(),
		}
		as.buffer = as.buffer[as.chunkSize:]

		if as.onChunk != nil {
			as.onChunk(chunk)
		}
	}
}

// Flush sends any remaining buffered audio.
func (as *AudioStream) Flush() {
	as.mu.Lock()
	defer as.mu.Unlock()

	if len(as.buffer) > 0 {
		chunk := types.AudioChunk{
			SessionID:  as.sessionID,
			Data:       as.buffer,
			SampleRate: as.sampleRate,
			Channels:   1,
			DurationMs: len(as.buffer) * 1000 / (as.sampleRate * 2),
			Timestamp:  time.Now(),
		}
		as.buffer = as.buffer[:0]
		if as.onChunk != nil {
			as.onChunk(chunk)
		}
	}
}
