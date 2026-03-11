package streaming

import (
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// AgentResponseToWSMessage wraps any agent response as a WebSocket message.
// Uses interface{} to avoid an import cycle with the agent package.
func AgentResponseToWSMessage(sessionID string, resp interface{}) types.WebSocketMessage {
	return types.WebSocketMessage{
		Type:      "agent_response",
		SessionID: sessionID,
		Payload:   resp,
		Timestamp: time.Now(),
	}
}
