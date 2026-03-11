package streaming

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

func generateID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// Fallback to timestamp-based ID if crypto/rand fails
		return fmt.Sprintf("argus_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
