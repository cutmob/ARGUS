package gemini

import (
	"encoding/json"
	"fmt"

	"google.golang.org/genai"

	"github.com/cutmob/argus/pkg/types"
)

// hazardResponseSchema defines the JSON schema for structured hazard output
// from Gemini's GenerateContent API.
func hazardResponseSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"hazards": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"rule_id":     map[string]any{"type": "string", "description": "ID of the matched inspection rule, or empty"},
						"description": map[string]any{"type": "string", "description": "What was observed"},
						"severity":    map[string]any{"type": "string", "enum": []string{"low", "medium", "high", "critical"}},
						"confidence":  map[string]any{"type": "number", "description": "0.0 to 1.0"},
					},
					"required": []string{"description", "severity", "confidence"},
				},
			},
			"text_response":  map[string]any{"type": "string", "description": "Brief summary of findings"},
			"voice_response": map[string]any{"type": "string", "description": "Short spoken alert if hazards found, empty if safe"},
			"scene_safe":     map[string]any{"type": "boolean"},
		},
		"required": []string{"hazards", "text_response", "scene_safe"},
	}
}

// buildAnalysisPrompt constructs the vision analysis prompt from rules and detected objects.
func buildAnalysisPrompt(req types.GeminiRequest) string {
	prompt := "You are ARGUS, an AI safety inspection system. Analyze this image for safety hazards.\n\n"

	if len(req.Objects) > 0 {
		prompt += "Objects detected in scene:\n"
		for _, obj := range req.Objects {
			prompt += fmt.Sprintf("- %s (confidence: %.0f%%)\n", obj.Label, obj.Confidence*100)
		}
		prompt += "\n"
	}

	if len(req.Rules) > 0 {
		prompt += "Evaluate against these inspection rules:\n"
		for i, rule := range req.Rules {
			prompt += fmt.Sprintf("%d. [%s] %s\n", i+1, rule.Severity, rule.Description)
		}
		prompt += "\n"
	}

	if req.Context != "" {
		prompt += req.Context + "\n\n"
	}

	prompt += "Return your analysis as structured JSON with hazards array, text_response, voice_response, and scene_safe boolean."
	return prompt
}

// parseGenerateContentResponse extracts structured data from a GenerateContent result.
func parseGenerateContentResponse(result *genai.GenerateContentResponse) (*types.GeminiResponse, error) {
	if result == nil || len(result.Candidates) == 0 {
		return &types.GeminiResponse{
			TextResponse: "No analysis available for this frame.",
		}, nil
	}

	candidate := result.Candidates[0]
	if candidate.Content == nil || len(candidate.Content.Parts) == 0 {
		return &types.GeminiResponse{
			TextResponse: "No content in response.",
		}, nil
	}

	text := ""
	for _, part := range candidate.Content.Parts {
		if part.Text != "" {
			text += part.Text
		}
	}

	if text == "" {
		return &types.GeminiResponse{
			TextResponse: "Empty response from model.",
		}, nil
	}

	var resp types.GeminiResponse
	if err := json.Unmarshal([]byte(text), &resp); err != nil {
		// Not valid JSON — treat as plain text
		return &types.GeminiResponse{
			TextResponse:  text,
			VoiceResponse: text,
		}, nil
	}

	return &resp, nil
}
