package reporting

import (
	"encoding/csv"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// CSVExporter writes hazard rows for spreadsheet and BI workflows.
type CSVExporter struct {
	outputDir string
}

func NewCSVExporter() *CSVExporter {
	dir := os.Getenv("ARGUS_REPORTS_DIR")
	if dir == "" {
		dir = "./reports"
	}
	_ = os.MkdirAll(dir, 0755)
	return &CSVExporter{outputDir: dir}
}

func (e *CSVExporter) Name() string { return "csv" }

func (e *CSVExporter) Export(report types.InspectionReport) error {
	filename := fmt.Sprintf("argus_report_%s_%s.csv",
		report.InspectionMode,
		time.Now().Format("20060102_150405"),
	)
	path := filepath.Join(e.outputDir, filename)

	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("creating csv report: %w", err)
	}
	defer f.Close()

	w := csv.NewWriter(f)
	defer w.Flush()

	header := []string{"report_id", "session_id", "inspection_mode", "risk_level", "risk_score", "hazard_index", "description", "severity", "confidence", "rule_id", "camera_id", "detected_at", "location"}
	if err := w.Write(header); err != nil {
		return fmt.Errorf("writing csv header: %w", err)
	}

	if len(report.Hazards) == 0 {
		row := []string{report.ID, report.SessionID, report.InspectionMode, string(report.RiskLevel), fmt.Sprintf("%.1f", report.RiskScore), "", "", "", "", "", "", "", ""}
		if err := w.Write(row); err != nil {
			return fmt.Errorf("writing csv row: %w", err)
		}
	} else {
		for i, h := range report.Hazards {
			detectedAt := ""
			if !h.DetectedAt.IsZero() {
				detectedAt = h.DetectedAt.Format(time.RFC3339)
			}
			row := []string{
				report.ID,
				report.SessionID,
				report.InspectionMode,
				string(report.RiskLevel),
				fmt.Sprintf("%.1f", report.RiskScore),
				fmt.Sprintf("%d", i+1),
				h.Description,
				string(h.Severity),
				fmt.Sprintf("%.4f", h.Confidence),
				h.RuleID,
				h.CameraID,
				detectedAt,
				h.Location,
			}
			if err := w.Write(row); err != nil {
				return fmt.Errorf("writing csv row: %w", err)
			}
		}
	}

	if err := w.Error(); err != nil {
		return fmt.Errorf("finalizing csv: %w", err)
	}

	slog.Info("report exported as CSV", "path", path)
	return nil
}
