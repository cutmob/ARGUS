package reporting

import (
	"bytes"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/cutmob/argus/pkg/types"
)

// PDFExporter generates PDF inspection reports.
type PDFExporter struct {
	outputDir string
}

func NewPDFExporter() *PDFExporter {
	dir := os.Getenv("ARGUS_REPORTS_DIR")
	if dir == "" {
		dir = "./reports"
	}
	os.MkdirAll(dir, 0755)
	return &PDFExporter{outputDir: dir}
}

func (e *PDFExporter) Name() string { return "pdf" }

func (e *PDFExporter) Export(report types.InspectionReport) error {
	filename := fmt.Sprintf("argus_report_%s_%s.pdf",
		report.InspectionMode,
		time.Now().Format("20060102_150405"),
	)
	path := filepath.Join(e.outputDir, filename)

	content := buildPlainTextReport(report)
	pdfData := encodeSimplePDF(content)
	if err := os.WriteFile(path, pdfData, 0644); err != nil {
		return fmt.Errorf("writing report: %w", err)
	}

	slog.Info("report exported as PDF", "path", path)
	return nil
}

func encodeSimplePDF(text string) []byte {
	escaped := escapePDFText(text)
	stream := "BT /F1 10 Tf 40 800 Td 12 TL (" + escaped + ") Tj ET"

	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n")

	offsets := []int{0}
	writeObj := func(obj string) {
		offsets = append(offsets, out.Len())
		out.WriteString(obj)
	}

	writeObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
	writeObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
	writeObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n")
	writeObj("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")
	writeObj(fmt.Sprintf("5 0 obj\n<< /Length %d >>\nstream\n%s\nendstream\nendobj\n", len(stream), stream))

	xrefPos := out.Len()
	out.WriteString("xref\n")
	out.WriteString(fmt.Sprintf("0 %d\n", len(offsets)))
	out.WriteString("0000000000 65535 f \n")
	for i := 1; i < len(offsets); i++ {
		out.WriteString(fmt.Sprintf("%010d 00000 n \n", offsets[i]))
	}
	out.WriteString("trailer\n")
	out.WriteString(fmt.Sprintf("<< /Size %d /Root 1 0 R >>\n", len(offsets)))
	out.WriteString("startxref\n")
	out.WriteString(fmt.Sprintf("%d\n", xrefPos))
	out.WriteString("%%EOF")

	return out.Bytes()
}

func escapePDFText(s string) string {
	b := make([]rune, 0, len(s)+32)
	for _, r := range s {
		switch r {
		case '\\':
			b = append(b, '\\', '\\')
		case '(':
			b = append(b, '\\', '(')
		case ')':
			b = append(b, '\\', ')')
		case '\r':
		case '\n':
			b = append(b, '\\', 'n')
		case '\t':
			b = append(b, ' ')
		default:
			if r < 32 {
				continue
			}
			if r > 126 {
				b = append(b, '?')
				continue
			}
			b = append(b, r)
		}
	}
	return string(b)
}
