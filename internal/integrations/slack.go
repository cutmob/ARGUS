package integrations

import (
	"fmt"
	"os"

	"github.com/cutmob/argus/pkg/types"
)

// SlackNotifier sends inspection alerts and reports to Slack channels.
type SlackNotifier struct {
	webhook *WebhookClient
	channel string
}

func NewSlackNotifier() *SlackNotifier {
	return &SlackNotifier{
		webhook: NewWebhookClient(),
		channel: os.Getenv("ARGUS_SLACK_CHANNEL"),
	}
}

// SendAlert posts a hazard alert to Slack.
func (sn *SlackNotifier) SendAlert(hazard types.Hazard, sessionID string) error {
	color := "#36a64f"
	switch hazard.Severity {
	case types.SeverityCritical:
		color = "#ff0000"
	case types.SeverityHigh:
		color = "#ff4444"
	case types.SeverityMedium:
		color = "#ffaa00"
	}

	payload := map[string]interface{}{
		"text": fmt.Sprintf("ARGUS Alert: %s", hazard.Description),
		"attachments": []map[string]interface{}{
			{
				"color": color,
				"fields": []map[string]string{
					{"title": "Severity", "value": string(hazard.Severity), "short": "true"},
					{"title": "Session", "value": sessionID, "short": "true"},
					{"title": "Description", "value": hazard.Description},
				},
			},
		},
	}

	slackURL := os.Getenv("ARGUS_SLACK_WEBHOOK_URL")
	return sn.webhook.SendTo(slackURL, payload)
}

// SendReport posts a report summary to Slack.
func (sn *SlackNotifier) SendReport(report types.InspectionReport) error {
	payload := map[string]interface{}{
		"text": fmt.Sprintf("ARGUS Report: %s inspection complete", report.InspectionMode),
		"attachments": []map[string]interface{}{
			{
				"color": "#0066cc",
				"fields": []map[string]string{
					{"title": "Risk Level", "value": string(report.RiskLevel), "short": "true"},
					{"title": "Issues Found", "value": fmt.Sprintf("%d", len(report.Hazards)), "short": "true"},
					{"title": "Summary", "value": report.Summary},
				},
			},
		},
	}

	slackURL := os.Getenv("ARGUS_SLACK_WEBHOOK_URL")
	return sn.webhook.SendTo(slackURL, payload)
}
