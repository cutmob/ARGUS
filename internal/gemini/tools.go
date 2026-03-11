package gemini

import (
	"google.golang.org/genai"
)

// ArgusTools returns the function declarations that Gemini can call
// during a live inspection session. These are the agent's capabilities.
func ArgusTools() []*genai.Tool {
	return []*genai.Tool{
		{
			FunctionDeclarations: []*genai.FunctionDeclaration{
				{
					Name:        "inspect_frame",
					Description: "Analyze the current camera frame for safety hazards against active inspection rules. Call this when you detect something that may be a safety concern.",
					Parameters: &genai.Schema{
						Type: "object",
						Properties: map[string]*genai.Schema{
							"hazards": {
								Type:        "array",
								Description: "List of detected hazards",
								Items: &genai.Schema{
									Type: "object",
									Properties: map[string]*genai.Schema{
										"description": {Type: "string", Description: "What was observed"},
										"severity":    {Type: "string", Description: "low, medium, high, or critical"},
										"confidence":  {Type: "number", Description: "0.0 to 1.0"},
										"rule_id":     {Type: "string", Description: "Matching rule ID if applicable"},
									},
									Required: []string{"description", "severity", "confidence"},
								},
							},
						},
						Required: []string{"hazards"},
					},
				},
				{
					Name:        "highlight_hazard",
					Description: "Highlight a detected hazard on the camera overlay for the user to see. Call this when a hazard should be visually marked.",
					Parameters: &genai.Schema{
						Type: "object",
						Properties: map[string]*genai.Schema{
							"label":    {Type: "string", Description: "Short label for the hazard"},
							"severity": {Type: "string", Description: "low, medium, high, or critical"},
						},
						Required: []string{"label", "severity"},
					},
				},
				{
					Name:        "switch_inspection_mode",
					Description: "Switch to a different inspection module. Available modes: elevator, construction, facility, warehouse, restaurant, factory, general.",
					Parameters: &genai.Schema{
						Type: "object",
						Properties: map[string]*genai.Schema{
							"mode": {Type: "string", Description: "The inspection mode to switch to"},
						},
						Required: []string{"mode"},
					},
				},
				{
					Name:        "generate_report",
					Description: "Generate an inspection report summarizing all detected hazards, risk score, and recommendations. Call when user requests a report or says 'generate report'.",
					Parameters: &genai.Schema{
						Type: "object",
						Properties: map[string]*genai.Schema{
							"format": {Type: "string", Description: "Export format: json, pdf, or webhook"},
						},
						Required: []string{"format"},
					},
				},
				{
					Name:        "log_issue",
					Description: "Log a specific safety issue to the inspection record. Call this for each confirmed hazard.",
					Parameters: &genai.Schema{
						Type: "object",
						Properties: map[string]*genai.Schema{
							"description": {Type: "string", Description: "Description of the issue"},
							"severity":    {Type: "string", Description: "low, medium, high, or critical"},
							"confidence":  {Type: "number", Description: "0.0 to 1.0"},
							"rule_id":     {Type: "string", Description: "Rule ID if matched"},
						},
						Required: []string{"description", "severity", "confidence"},
					},
				},
				{
					Name:        "get_inspection_status",
					Description: "Get the current inspection status including hazard count, risk level, and active mode. Call when user asks about status or progress.",
					Parameters: &genai.Schema{
						Type: "object",
						Properties: map[string]*genai.Schema{},
					},
				},
			},
		},
	}
}
