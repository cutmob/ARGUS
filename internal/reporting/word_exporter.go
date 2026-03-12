package reporting

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// WordExporter writes Word-compatible .doc files using HTML payload.
type WordExporter struct {
	outputDir string
}

func NewWordExporter() *WordExporter {
	dir := os.Getenv("ARGUS_REPORTS_DIR")
	if dir == "" {
		dir = "./reports"
	}
	_ = os.MkdirAll(dir, 0755)
	return &WordExporter{outputDir: dir}
}

func (e *WordExporter) Name() string { return "word" }

func (e *WordExporter) Export(report types.InspectionReport) error {
	filename := fmt.Sprintf("argus_report_%s_%s.doc",
		report.InspectionMode,
		time.Now().Format("20060102_150405"),
	)
	path := filepath.Join(e.outputDir, filename)

	html := buildHTMLReport(report)
	if err := os.WriteFile(path, []byte(html), 0644); err != nil {
		return fmt.Errorf("writing word report: %w", err)
	}

	slog.Info("report exported as WORD", "path", path)
	return nil
}
