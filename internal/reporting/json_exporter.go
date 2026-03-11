package reporting

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// JSONExporter writes reports as structured JSON files.
type JSONExporter struct {
	outputDir string
}

func NewJSONExporter() *JSONExporter {
	dir := os.Getenv("ARGUS_REPORTS_DIR")
	if dir == "" {
		dir = "./reports"
	}
	os.MkdirAll(dir, 0755)
	return &JSONExporter{outputDir: dir}
}

func (e *JSONExporter) Name() string { return "json" }

func (e *JSONExporter) Export(report types.InspectionReport) error {
	filename := fmt.Sprintf("argus_report_%s_%s.json",
		report.InspectionMode,
		time.Now().Format("20060102_150405"),
	)
	path := filepath.Join(e.outputDir, filename)

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling report: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("writing report file: %w", err)
	}

	slog.Info("report exported as JSON", "path", path)
	return nil
}
