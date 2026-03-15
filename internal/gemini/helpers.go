package gemini

import (
	"encoding/json"
	"fmt"
	"strings"

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
						"location":    map[string]any{"type": "string", "description": "Spatial location in the scene, e.g. 'left side near exit door', 'overhead center', 'ground level right'"},
						"camera_id":   map[string]any{"type": "string", "description": "Camera that captured this hazard"},
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

// BuildInspectionPrompt builds the system prompt for a Gemini session.
// forLive=true omits the JSON OUTPUT CONTRACT (Live sessions use function
// calling for hazard reporting, not JSON text output).
func BuildInspectionPrompt(
	modulePrompt string,
	mode string,
	cameraID string,
	alertThreshold string,
	runtimeContext string,
	environmentFamiliarity string,
) string {
	return buildPrompt(modulePrompt, mode, cameraID, alertThreshold, runtimeContext, environmentFamiliarity, false)
}

// BuildLiveInspectionPrompt builds the system prompt for a Gemini Live session.
// It omits the JSON OUTPUT CONTRACT — Live sessions report hazards via function
// calls (inspect_frame, highlight_hazard) not JSON text responses.
func BuildLiveInspectionPrompt(
	modulePrompt string,
	mode string,
	cameraID string,
	alertThreshold string,
	runtimeContext string,
	environmentFamiliarity string,
) string {
	return buildPrompt(modulePrompt, mode, cameraID, alertThreshold, runtimeContext, environmentFamiliarity, true)
}

func buildPrompt(
	modulePrompt string,
	mode string,
	cameraID string,
	alertThreshold string,
	runtimeContext string,
	environmentFamiliarity string,
	forLive bool,
) string {
	corePolicyLines := []string{
		"- YOUR #1 JOB: Proactively scan every video frame for hazards and IMMEDIATELY call inspect_frame + highlight_hazard when you spot anything. Do NOT wait for the operator to ask. Act the moment you see it.",
		"- Tool calls are your PRIMARY output. Speaking is secondary. When you see a hazard: FIRST call the tools, THEN briefly tell the operator what you found.",
		"- When the session starts, greet the operator briefly (e.g. 'ARGUS online, ready to inspect.') then immediately begin scanning.",
		"- Always respond to the operator when they speak to you.",
		"- Ground every finding in visible evidence from the current scene.",
		"- Do not invent unseen hazards, but be thorough — flag anything that looks like a safety concern.",
		"- Keep spoken responses short, single-turn, non-repetitive, and operationally useful.",
	}

	if forLive {
		corePolicyLines = append(corePolicyLines,
			"- For EVERY hazard: call inspect_frame to log it AND call highlight_hazard with box_2d to draw the overlay. Always do both.",
			"- SILENT MONITORING: You will periodically receive messages tagged [MONITORING_SCAN]. These are automatic system prompts — NOT from the operator. When you receive one: (1) analyze the current video frame, (2) if you see NEW unreported hazards, call inspect_frame + highlight_hazard and briefly tell the operator, (3) if the scene is unchanged or safe, produce NO output at all — no speech, no text, no acknowledgment. NEVER say 'scanning', 'checking', 'let me look', or similar. Just silently act or stay silent.",
			"- Do not repeat previously reported hazards unless risk has materially increased or the operator asks for a recap.",
		)
	} else {
		corePolicyLines = append(corePolicyLines,
			"- When no meaningful hazards are visible, return an empty hazards array, set scene_safe to true, and leave voice_response empty.",
			"- Do not repeat previously reported findings unless risk has materially increased or the operator explicitly asks for a recap.",
		)
	}

	sections := []string{
		"ROLE\nYou are ARGUS, a high-reliability visual safety inspection copilot. Your job is to identify visually supported hazards, compliance risks, and notable safety conditions without inventing evidence.",
		"CORE POLICY\n" + strings.Join(corePolicyLines, "\n"),
	}

	modulePrompt = strings.TrimSpace(modulePrompt)
	if modulePrompt != "" {
		sections = append(sections, "DOMAIN GUIDANCE\n"+modulePrompt)
	}

	runtimeLines := []string{
		"Active inspection mode: " + mode,
	}
	if cameraID != "" {
		runtimeLines = append(runtimeLines, "Camera: "+cameraID)
	}
	if alertThreshold != "" {
		runtimeLines = append(runtimeLines, "Spoken alert threshold: "+alertThreshold+". Always call inspect_frame and highlight_hazard for ALL hazards regardless of severity. But only SPEAK aloud about findings at "+alertThreshold+" severity or above — log lower-severity findings silently via tools.")
	}
	runtimeLines = append(runtimeLines,
		"Describe hazard locations spatially (for example: left side, near exit, overhead, ground level, foreground/background).",
	)
	if forLive {
		runtimeLines = append(runtimeLines,
			"For every hazard you can spatially localize, call highlight_hazard with box_2d coordinates [ymin, xmin, ymax, xmax] (values 0-1000). Always provide box_2d when the hazard occupies a visible region — spatial precision is critical for incident tracking.",
			"Do not re-report hazards the operator has dismissed via dismiss_finding unless conditions materially change.",
		)
	} else {
		runtimeLines = append(runtimeLines,
			"For each hazard, include a location field describing where in the frame the hazard appears.",
		)
	}
	runtimeLines = append(runtimeLines,
		"Limit reported hazards to at most 25 per observation batch to ensure response quality.",
		"Reference the camera when relevant.",
		"Severity calibration: low = minor housekeeping or low-immediacy issue; medium = clear safety/compliance concern needing follow-up; high = serious hazard needing prompt intervention; critical = imminent life-safety danger requiring immediate action.",
	)
	if strings.TrimSpace(environmentFamiliarity) != "" {
		runtimeLines = append(runtimeLines, "Retrieved environment familiarity:\n"+strings.TrimSpace(environmentFamiliarity))
	}
	if strings.TrimSpace(runtimeContext) != "" {
		runtimeLines = append(runtimeLines, strings.TrimSpace(runtimeContext))
	}
	sections = append(sections, "RUNTIME CONTEXT\n"+strings.Join(runtimeLines, "\n"))

	if !forLive {
		sections = append(sections,
			"OUTPUT CONTRACT\nReturn valid JSON only. Use this schema:\n{\n  \"hazards\": [\n    {\n      \"rule_id\": \"string\",\n      \"description\": \"string\",\n      \"severity\": \"low|medium|high|critical\",\n      \"confidence\": 0.0,\n      \"location\": \"string\",\n      \"camera_id\": \"string\"\n    }\n  ],\n  \"text_response\": \"short operator summary\",\n  \"voice_response\": \"short spoken summary or empty string\",\n  \"scene_safe\": true\n}",
			"DECISION RULES\n- Include only findings supported by visible evidence.\n- If a standard is referenced, only do so when it is reasonably applicable.\n- If the scene is partially occluded or ambiguous, mention uncertainty in text_response.\n- Rank imminent life-safety risks above routine deficiencies.\n- Do not output markdown fences or commentary outside the JSON object.",
		)
	} else {
		sections = append(sections,
			"DECISION RULES\n- Include only findings supported by visible evidence.\n- If a standard is referenced, only do so when it is reasonably applicable.\n- If the scene is partially occluded or ambiguous, mention uncertainty in your spoken response.\n- Rank imminent life-safety risks above routine deficiencies.",
		)
	}

	return strings.Join(sections, "\n\n")
}

// buildAnalysisPrompt constructs the vision analysis prompt from rules and detected objects.
func buildAnalysisPrompt(req types.GeminiRequest) string {
	runtimeParts := make([]string, 0, 4)
	if req.Frame != nil {
		runtimeParts = append(runtimeParts, fmt.Sprintf("Frame captured: %s", req.Frame.Timestamp.Format("2006-01-02T15:04:05Z07:00")))
	}
	if len(req.Objects) > 0 {
		objectLines := make([]string, 0, len(req.Objects))
		for _, obj := range req.Objects {
			objectLines = append(objectLines, fmt.Sprintf("- %s (confidence: %.0f%%)", obj.Label, obj.Confidence*100))
		}
		runtimeParts = append(runtimeParts, "Objects detected in scene:\n"+strings.Join(objectLines, "\n"))
	}
	return BuildInspectionPrompt(
		"",
		"one-shot analysis",
		func() string {
			if req.Frame != nil {
				return req.Frame.CameraID
			}
			return ""
		}(),
		"",
		strings.TrimSpace(strings.Join([]string{strings.Join(runtimeParts, "\n"), req.Context}, "\n\n")),
		"",
	)
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
		// Intentional: fall back to plain text on invalid JSON
		return &types.GeminiResponse{ //nolint:nilerr
			TextResponse:  text,
			VoiceResponse: text,
		}, nil
	}

	return &resp, nil
}
