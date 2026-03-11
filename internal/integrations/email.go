package integrations

import (
	"fmt"
	"log/slog"
	"net/smtp"
	"os"
	"strings"

	"github.com/cutmob/argus/pkg/types"
)

// EmailNotifier sends inspection reports via email.
type EmailNotifier struct {
	smtpHost string
	smtpPort string
	from     string
	password string
}

func NewEmailNotifier() *EmailNotifier {
	return &EmailNotifier{
		smtpHost: os.Getenv("ARGUS_SMTP_HOST"),
		smtpPort: os.Getenv("ARGUS_SMTP_PORT"),
		from:     os.Getenv("ARGUS_EMAIL_FROM"),
		password: os.Getenv("ARGUS_EMAIL_PASSWORD"),
	}
}

// SendReport emails a report to the specified recipients.
func (en *EmailNotifier) SendReport(report types.InspectionReport, recipients []string) error {
	if en.smtpHost == "" {
		return fmt.Errorf("SMTP not configured")
	}

	subject := fmt.Sprintf("ARGUS Inspection Report: %s - Risk: %s",
		report.InspectionMode, report.RiskLevel)

	var body strings.Builder
	body.WriteString("ARGUS INSPECTION REPORT\n")
	body.WriteString("========================\n\n")
	body.WriteString(fmt.Sprintf("Inspection: %s\n", report.InspectionMode))
	body.WriteString(fmt.Sprintf("Risk Level: %s\n", report.RiskLevel))
	body.WriteString(fmt.Sprintf("Issues: %d\n\n", len(report.Hazards)))
	body.WriteString(report.Summary + "\n\n")

	for i, h := range report.Hazards {
		body.WriteString(fmt.Sprintf("%d. [%s] %s\n", i+1, h.Severity, h.Description))
	}

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s",
		en.from,
		strings.Join(recipients, ","),
		subject,
		body.String(),
	)

	auth := smtp.PlainAuth("", en.from, en.password, en.smtpHost)
	addr := en.smtpHost + ":" + en.smtpPort

	err := smtp.SendMail(addr, auth, en.from, recipients, []byte(msg))
	if err != nil {
		return fmt.Errorf("sending email: %w", err)
	}

	slog.Info("report emailed", "recipients", recipients, "report_id", report.ID)
	return nil
}
