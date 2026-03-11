package reporting

import (
	"log/slog"

	"github.com/cutmob/argus/internal/integrations"
	"github.com/cutmob/argus/pkg/types"
)

// WebhookExporter sends reports to configured webhook endpoints.
type WebhookExporter struct {
	client *integrations.WebhookClient
}

func NewWebhookExporter(client *integrations.WebhookClient) *WebhookExporter {
	return &WebhookExporter{client: client}
}

func (e *WebhookExporter) Name() string { return "webhook" }

func (e *WebhookExporter) Export(report types.InspectionReport) error {
	slog.Info("exporting report via webhook",
		"report_id", report.ID,
		"mode", report.InspectionMode,
	)
	return e.client.Send(report)
}
