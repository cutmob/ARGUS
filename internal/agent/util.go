package agent

import (
	"fmt"
	"strings"
)

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

func ftoa(f float64) string {
	return fmt.Sprintf("%.1f", f)
}

func joinStrings(s []string) string {
	return strings.Join(s, ", ")
}
