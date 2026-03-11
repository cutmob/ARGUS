package integrations

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// WebhookClient sends structured payloads to external webhook endpoints.
// Supports any system that accepts JSON webhooks (Slack, Jira, ServiceNow, etc.).
type WebhookClient struct {
	httpClient *http.Client
	defaultURL string
}

func NewWebhookClient() *WebhookClient {
	return &WebhookClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		defaultURL: os.Getenv("ARGUS_WEBHOOK_URL"),
	}
}

// Send dispatches a payload to the configured webhook URL.
func (wc *WebhookClient) Send(payload interface{}) error {
	return wc.SendTo(wc.defaultURL, payload)
}

// SendTo dispatches a payload to a specific webhook URL.
func (wc *WebhookClient) SendTo(url string, payload interface{}) error {
	if url == "" {
		return fmt.Errorf("webhook URL not configured")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshaling webhook payload: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("creating webhook request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "ARGUS-Inspection-System/1.0")

	resp, err := wc.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("sending webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	slog.Info("webhook sent", "url", url, "status", resp.StatusCode)
	return nil
}
