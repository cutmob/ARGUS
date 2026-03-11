package reporting

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// ReportBuilder constructs and stores inspection reports.
type ReportBuilder struct {
	mu       sync.RWMutex
	reports  map[string]*types.InspectionReport
	registry *ExportRegistry
}

func NewReportBuilder(registry *ExportRegistry) *ReportBuilder {
	return &ReportBuilder{
		reports:  make(map[string]*types.InspectionReport),
		registry: registry,
	}
}

// Build creates a report and exports it in the specified format.
func (rb *ReportBuilder) Build(report types.InspectionReport, format string) error {
	if report.ID == "" {
		report.ID = fmt.Sprintf("report_%d", time.Now().UnixMilli())
	}
	if report.CreatedAt.IsZero() {
		report.CreatedAt = time.Now()
	}

	// Generate summary and recommendations
	report.Summary = rb.generateSummary(report)
	report.Recommendations = rb.generateRecommendations(report)

	// Store
	rb.mu.Lock()
	rb.reports[report.ID] = &report
	rb.mu.Unlock()

	slog.Info("report built",
		"id", report.ID,
		"mode", report.InspectionMode,
		"hazards", len(report.Hazards),
		"risk_level", report.RiskLevel,
	)

	// Export
	if format != "" {
		return rb.registry.Export(format, report)
	}
	return nil
}

// Get retrieves a stored report by ID.
func (rb *ReportBuilder) Get(id string) (*types.InspectionReport, bool) {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	r, ok := rb.reports[id]
	return r, ok
}

// List returns all stored reports.
func (rb *ReportBuilder) List() []*types.InspectionReport {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	result := make([]*types.InspectionReport, 0, len(rb.reports))
	for _, r := range rb.reports {
		result = append(result, r)
	}
	return result
}

// Export sends an existing report through an exporter.
func (rb *ReportBuilder) Export(reportID string, format string) error {
	report, ok := rb.Get(reportID)
	if !ok {
		return fmt.Errorf("report %s not found", reportID)
	}
	return rb.registry.Export(format, *report)
}

func (rb *ReportBuilder) generateSummary(report types.InspectionReport) string {
	if len(report.Hazards) == 0 {
		return "No hazards detected during inspection."
	}

	high := 0
	medium := 0
	low := 0
	for _, h := range report.Hazards {
		switch h.Severity {
		case types.SeverityCritical, types.SeverityHigh:
			high++
		case types.SeverityMedium:
			medium++
		default:
			low++
		}
	}

	return fmt.Sprintf(
		"%s inspection completed. %d total findings: %d high/critical, %d medium, %d low. Overall risk: %s.",
		report.InspectionMode,
		len(report.Hazards),
		high, medium, low,
		report.RiskLevel,
	)
}

func (rb *ReportBuilder) generateRecommendations(report types.InspectionReport) []string {
	var recs []string
	seen := make(map[string]bool)

	for _, h := range report.Hazards {
		rec := "Address: " + h.Description
		if !seen[rec] {
			recs = append(recs, rec)
			seen[rec] = true
		}
	}

	if report.RiskLevel == types.SeverityHigh || report.RiskLevel == types.SeverityCritical {
		recs = append(recs, "Immediate remediation required for high-severity findings.")
	}

	return recs
}

// HTTP handlers

func (rb *ReportBuilder) HandleCreateReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SessionID string `json:"session_id"`
		Format    string `json:"format"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "report creation should be triggered via voice or agent",
	})
}

func (rb *ReportBuilder) HandleGetReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Path[len("/api/v1/reports/"):]
	report, ok := rb.Get(id)
	if !ok {
		http.Error(w, "report not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(report)
}
