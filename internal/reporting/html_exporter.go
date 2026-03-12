package reporting

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// HTMLExporter writes print-friendly browser-viewable reports.
type HTMLExporter struct {
	outputDir string
}

func NewHTMLExporter() *HTMLExporter {
	dir := os.Getenv("ARGUS_REPORTS_DIR")
	if dir == "" {
		dir = "./reports"
	}
	_ = os.MkdirAll(dir, 0755)
	return &HTMLExporter{outputDir: dir}
}

func (e *HTMLExporter) Name() string { return "html" }

func (e *HTMLExporter) Export(report types.InspectionReport) error {
	filename := fmt.Sprintf("argus_report_%s_%s.html",
		report.InspectionMode,
		time.Now().Format("20060102_150405"),
	)
	path := filepath.Join(e.outputDir, filename)

	content := buildHTMLReport(report)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return fmt.Errorf("writing html report: %w", err)
	}

	slog.Info("report exported as HTML", "path", path)
	return nil
}
