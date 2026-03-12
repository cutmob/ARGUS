package reporting

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// TXTExporter writes human-readable plain text reports.
type TXTExporter struct {
	outputDir string
}

func NewTXTExporter() *TXTExporter {
	dir := os.Getenv("ARGUS_REPORTS_DIR")
	if dir == "" {
		dir = "./reports"
	}
	_ = os.MkdirAll(dir, 0755)
	return &TXTExporter{outputDir: dir}
}

func (e *TXTExporter) Name() string { return "txt" }

func (e *TXTExporter) Export(report types.InspectionReport) error {
	filename := fmt.Sprintf("argus_report_%s_%s.txt",
		report.InspectionMode,
		time.Now().Format("20060102_150405"),
	)
	path := filepath.Join(e.outputDir, filename)

	content := buildPlainTextReport(report)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return fmt.Errorf("writing txt report: %w", err)
	}

	slog.Info("report exported as TXT", "path", path)
	return nil
}
