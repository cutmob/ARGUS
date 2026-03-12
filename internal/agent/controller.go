package agent

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"google.golang.org/genai"

	geminiPkg "github.com/cutmob/argus/internal/gemini"
	"github.com/cutmob/argus/internal/inspection"
	"github.com/cutmob/argus/internal/reporting"
	"github.com/cutmob/argus/internal/session"
	"github.com/cutmob/argus/internal/vision"
	"github.com/cutmob/argus/pkg/types"
)

// ControllerConfig holds all dependencies for the agent controller.
type ControllerConfig struct {
	SessionManager *session.Manager
	RuleEngine     *inspection.RuleEngine
	HazardDetector *inspection.HazardDetector
	Detector       *vision.Detector
	ReportBuilder  *reporting.ReportBuilder
	ModuleLoader   *inspection.ModuleLoader
	GeminiClient   *geminiPkg.Client
	OnResponse     func(sessionID string, resp *AgentResponse)
}

// Controller is the ARGUS agent brain.
// It orchestrates vision analysis, intent handling, Gemini Live sessions,
// and response generation.
type Controller struct {
	sessions     *session.Manager
	rules        *inspection.RuleEngine
	hazards      *inspection.HazardDetector
	detector     *vision.Detector
	reports      *reporting.ReportBuilder
	modules      *inspection.ModuleLoader
	gemini       *geminiPkg.Client
	intentParser *IntentParser
	responseMgr  *ResponseManager
	onResponse   func(sessionID string, resp *AgentResponse)

	mu           sync.RWMutex
	liveSessions map[string]*geminiPkg.LiveSession
}

func NewController(cfg ControllerConfig) *Controller {
	return &Controller{
		sessions:     cfg.SessionManager,
		rules:        cfg.RuleEngine,
		hazards:      cfg.HazardDetector,
		detector:     cfg.Detector,
		reports:      cfg.ReportBuilder,
		modules:      cfg.ModuleLoader,
		gemini:       cfg.GeminiClient,
		intentParser: NewIntentParser(),
		responseMgr:  NewResponseManager(),
		onResponse:   cfg.OnResponse,
		liveSessions: make(map[string]*geminiPkg.LiveSession),
	}
}

// HandleFrame processes an incoming video frame through the full pipeline.
func (c *Controller) HandleFrame(sessionID string, frame types.Frame) {
	sess, ok := c.sessions.Get(sessionID)
	if !ok {
		slog.Warn("frame for unknown session", "session_id", sessionID)
		return
	}

	// Store in rolling buffer for temporal reasoning
	sess.FrameBuffer.Push(frame)

	// Run local vision pipeline (sampling + event detection)
	events := c.detector.ProcessFrame(sessionID, frame)

	for _, event := range events {
		c.processVisionEvent(sess, event)
	}
}

// HandleAudio forwards audio chunks to the Gemini Live session.
// Audio must be raw 16-bit PCM, 16kHz, little-endian, mono.
func (c *Controller) HandleAudio(sessionID string, chunk types.AudioChunk) {
	_, ok := c.sessions.Get(sessionID)
	if !ok {
		return
	}

	c.mu.RLock()
	ls, hasLive := c.liveSessions[sessionID]
	c.mu.RUnlock()

	if !hasLive || !ls.IsActive() {
		return
	}

	if err := ls.SendAudio(chunk.Data); err != nil {
		slog.Error("failed to send audio to gemini",
			"session_id", sessionID,
			"error", err,
		)
	}
}

// HandleEvent processes control events from the WebSocket.
func (c *Controller) HandleEvent(sessionID string, event types.VisionEvent) {
	if event.Type == types.EventUserQuery {
		slog.Debug("user query event", "session_id", sessionID)
	}
}

// HandleIntent processes a parsed user intent.
func (c *Controller) HandleIntent(sessionID string, intent types.AgentIntent) *AgentResponse {
	switch intent.Type {
	case types.IntentStartInspection:
		return c.startInspection(sessionID, intent)
	case types.IntentStopInspection:
		return c.stopInspection(sessionID)
	case types.IntentSwitchMode:
		return c.switchMode(sessionID, intent.Mode)
	case types.IntentExportReport, types.IntentGenerateReport:
		return c.generateReport(sessionID, intent)
	case types.IntentQueryHazards:
		return c.queryHazards(sessionID)
	case types.IntentQueryStatus:
		return c.queryStatus(sessionID)
	case types.IntentOperatorActions:
		return c.operatorActions(sessionID)
	default:
		return c.responseMgr.Conversation("I'm listening. How can I help with the inspection?")
	}
}

// HandleRawText parses natural language and executes the mapped intent.
func (c *Controller) HandleRawText(sessionID string, text string) *AgentResponse {
	intent := c.intentParser.Parse(text)
	intent.RawText = text
	if intent.Type == types.IntentConversation {
		return c.responseMgr.Conversation("I'm listening. Say inspect, report, mode switch, status, or top actions.")
	}
	return c.HandleIntent(sessionID, intent)
}

func (c *Controller) startInspection(sessionID string, intent types.AgentIntent) *AgentResponse {
	mode := intent.Mode
	if mode == "" {
		mode = "general"
	}

	mod, err := c.modules.Load(mode)
	if err != nil {
		return c.responseMgr.Error("I don't have an inspection module for " + mode)
	}

	cameraID := ""
	if intent.Parameters != nil {
		cameraID = intent.Parameters["camera_id"]
	}

	sess := c.sessions.Create(session.SessionConfig{
		SessionID:      sessionID,
		InspectionMode: mode,
		RulesetID:      mod.Name + "_v" + mod.Version,
		CameraID:       cameraID,
		BufferSize:     30,
		Metadata:       intent.Parameters,
	})

	c.rules.LoadRules(sessionID, mod.Rules)

	// Build system prompt from module + rules
	systemPrompt := mod.SystemPrompt
	if systemPrompt == "" {
		systemPrompt = "You are ARGUS, an AI safety inspection copilot. Analyze the environment for hazards."
	}

	systemPrompt += "\n\nSpatial & temporal awareness:" +
		"\n- Each frame arrives with a timestamp and camera ID in the format [FRAME <ISO8601> | camera:<id>]." +
		"\n- Use timestamps to track how long hazards persist and note elapsed time in alerts." +
		"\n- Use the camera ID to distinguish between multiple feeds and reference which camera spotted an issue." +
		"\n- Describe hazard locations spatially (e.g. \"left side of frame\", \"near the exit door\", \"overhead\", \"at ground level\")." +
		"\n- When reporting, include the approximate location within the scene and which camera captured it." +
		"\n\nActive inspection mode: " + mode +
		"\nCamera: " + cameraID +
		"\nSession started: " + time.Now().Format("2006-01-02T15:04:05Z07:00") +
		"\nRules loaded: " + itoa(len(mod.Rules))
	for i, r := range mod.Rules {
		systemPrompt += "\n" + itoa(i+1) + ". [" + string(r.Severity) + "] " + r.Description
	}

	// Start Gemini Live session for real-time bidirectional streaming
	ctx := context.Background()
	liveSession, err := geminiPkg.NewLiveSession(ctx, c.gemini, geminiPkg.LiveSessionConfig{
		SessionID:    sessionID,
		SystemPrompt: systemPrompt,
		Tools:        geminiPkg.ArgusTools(),
		OnText:       c.handleGeminiText,
		OnAudio:      c.handleGeminiAudio,
		OnToolCall:   c.handleGeminiToolCall,
		OnTranscript: c.handleGeminiTranscript,
	})
	if err != nil {
		slog.Error("failed to start gemini live session",
			"session_id", sessionID,
			"error", err,
		)
		return c.responseMgr.Error("Failed to connect to Gemini Live API: " + err.Error())
	}

	c.mu.Lock()
	c.liveSessions[sessionID] = liveSession
	c.mu.Unlock()

	slog.Info("inspection started",
		"session_id", sess.ID,
		"mode", mode,
		"rules_count", len(mod.Rules),
	)

	return c.responseMgr.Voice(
		"Starting " + mode + " inspection. I have " +
			itoa(len(mod.Rules)) + " rules loaded. Point the camera and I'll begin analyzing.",
	)
}

func (c *Controller) stopInspection(sessionID string) *AgentResponse {
	c.mu.Lock()
	if ls, ok := c.liveSessions[sessionID]; ok {
		ls.Close()
		delete(c.liveSessions, sessionID)
	}
	c.mu.Unlock()

	sess, ok := c.sessions.Close(sessionID)
	if !ok {
		return c.responseMgr.Error("No active inspection to stop.")
	}

	c.rules.ClearSession(sessionID)

	return c.responseMgr.Voice(
		"Inspection complete. Found " + itoa(len(sess.Hazards)) +
			" issues. Say 'generate report' to create the inspection report.",
	)
}

func (c *Controller) switchMode(sessionID string, mode string) *AgentResponse {
	mod, err := c.modules.Load(mode)
	if err != nil {
		available := c.modules.ListAvailable()
		return c.responseMgr.Error(
			"Module '" + mode + "' not found. Available: " + joinStrings(available),
		)
	}

	c.rules.LoadRules(sessionID, mod.Rules)

	c.mu.RLock()
	ls, hasLive := c.liveSessions[sessionID]
	c.mu.RUnlock()

	if hasLive && ls.IsActive() {
		switchMsg := "Inspection mode changed to " + mode + ". New rules:\n"
		for i, r := range mod.Rules {
			switchMsg += itoa(i+1) + ". [" + string(r.Severity) + "] " + r.Description + "\n"
		}
		if err := ls.SendText(switchMsg); err != nil {
			slog.Error("failed to notify live session of mode switch", "error", err)
		}
	}

	return c.responseMgr.Voice(
		"Switched to " + mode + " inspection mode. " +
			itoa(len(mod.Rules)) + " rules active.",
	)
}

func (c *Controller) generateReport(sessionID string, intent types.AgentIntent) *AgentResponse {
	sess, ok := c.sessions.Get(sessionID)
	if !ok {
		return c.responseMgr.Error("No active session found.")
	}

	format := intent.Format
	if format == "" {
		format = "json"
	}

	report := types.InspectionReport{
		ID:             sessionID + "_report",
		SessionID:      sessionID,
		InspectionMode: sess.InspectionMode,
		Hazards:        sess.Hazards,
		RiskLevel:      c.hazards.CalculateRiskLevel(sess.Hazards),
		RiskScore:      c.hazards.CalculateRiskScore(sess.Hazards),
		CreatedAt:      time.Now(),
	}

	if err := c.reports.Build(report, format); err != nil {
		return c.responseMgr.Error("Failed to generate report: " + err.Error())
	}

	return c.responseMgr.Voice(
		"Report generated with " + itoa(len(report.Hazards)) +
			" findings. Risk level: " + string(report.RiskLevel) +
			". Would you like me to export it?",
	)
}

func (c *Controller) queryHazards(sessionID string) *AgentResponse {
	sess, ok := c.sessions.Get(sessionID)
	if !ok {
		return c.responseMgr.Error("No active session.")
	}

	if len(sess.Hazards) == 0 {
		return c.responseMgr.Voice("No hazards detected so far.")
	}

	summary := itoa(len(sess.Hazards)) + " hazards detected. "
	high := 0
	for _, h := range sess.Hazards {
		if h.Severity == types.SeverityHigh || h.Severity == types.SeverityCritical {
			high++
		}
	}
	if high > 0 {
		summary += itoa(high) + " are high severity or above."
	}
	for _, h := range sess.Hazards {
		if h.PersistenceSeconds >= 15 {
			summary += " Persistent hazard: " + h.Description +
				" for " + itoa(h.PersistenceSeconds) + " seconds, trend " + h.RiskTrend + "."
			break
		}
	}

	return c.responseMgr.Voice(summary)
}

func (c *Controller) queryStatus(sessionID string) *AgentResponse {
	sess, ok := c.sessions.Get(sessionID)
	if !ok {
		return c.responseMgr.Voice("No active inspection session.")
	}

	return c.responseMgr.Voice(
		"Active " + sess.InspectionMode + " inspection. " +
			itoa(len(sess.Hazards)) + " hazards found. " +
			"Risk score: " + ftoa(sess.RiskScore),
	)
}

func (c *Controller) operatorActions(sessionID string) *AgentResponse {
	sess, ok := c.sessions.Get(sessionID)
	if !ok {
		return c.responseMgr.Error("No active inspection session.")
	}
	if len(sess.Hazards) == 0 {
		return c.responseMgr.OperatorActions("No immediate actions. Continue monitoring and keep exits clear.", nil)
	}

	actions := make([]types.ActionCard, 0, 3)
	for i := 0; i < len(sess.Hazards) && len(actions) < 3; i++ {
		h := sess.Hazards[i]
		priority := "monitor"
		switch h.Severity {
		case types.SeverityCritical:
			priority = "immediate"
		case types.SeverityHigh:
			priority = "urgent"
		case types.SeverityMedium:
			priority = "high"
		}

		card := types.ActionCard{
			Title:       "Mitigate: " + h.Description,
			Priority:    priority,
			Reason:      "Rule " + h.RuleID + ", confidence " + ftoa(h.Confidence*100) + "%, camera " + h.CameraID,
			CameraID:    h.CameraID,
			HazardRefID: h.ID,
			Actions: []string{
				"Secure the area and warn nearby personnel",
				"Assign a supervisor to verify mitigation now",
				"Re-scan this zone after corrective action",
			},
		}
		if h.PersistenceSeconds >= 10 {
			card.Reason += ", persisted " + itoa(h.PersistenceSeconds) + "s (" + h.RiskTrend + ")"
		}
		actions = append(actions, card)
	}

	return c.responseMgr.OperatorActions(
		"Top "+itoa(len(actions))+" immediate actions generated for this zone.",
		actions,
	)
}

// processVisionEvent handles events from the local vision pipeline.
func (c *Controller) processVisionEvent(sess *session.Session, event types.VisionEvent) {
	switch event.Type {
	case types.EventHazardCandidate, types.EventSceneChange, types.EventPeriodicSample:
		c.sendFrameToGemini(sess, event)
	}
}

// sendFrameToGemini sends a frame to Gemini for analysis.
// Uses the Live session if active, falls back to one-shot GenerateContent.
func (c *Controller) sendFrameToGemini(sess *session.Session, event types.VisionEvent) {
	c.mu.RLock()
	ls, hasLive := c.liveSessions[sess.ID]
	c.mu.RUnlock()

	// Live session path: stream the frame with spatial/temporal context
	if hasLive && ls.IsActive() && event.Frame != nil {
		// Inject timestamp + camera context so Gemini can reason about time and space
		meta := "[FRAME " + event.Frame.Timestamp.Format("2006-01-02T15:04:05Z07:00") +
			" | camera:" + event.Frame.CameraID + "]"
		if err := ls.SendText(meta); err != nil {
			slog.Debug("failed to send frame metadata", "error", err)
		}
		if err := ls.SendVideoFrame(event.Frame.Data); err != nil {
			slog.Error("failed to send frame to gemini live",
				"session_id", sess.ID,
				"error", err,
			)
		}
		return
	}

	// Fallback: one-shot GenerateContent for frame analysis
	if event.Frame != nil && c.gemini != nil {
		rules := c.rules.GetRules(sess.ID)
		req := types.GeminiRequest{
			SessionID: sess.ID,
			Frame:     event.Frame,
			Objects:   event.Objects,
			Rules:     rules,
			Context:   c.rules.BuildPromptContext(sess.ID),
		}

		ctx := context.Background()
		resp, err := c.gemini.AnalyzeFrame(ctx, req)
		if err != nil {
			slog.Error("gemini frame analysis failed",
				"session_id", sess.ID,
				"error", err,
			)
			return
		}

		c.processGeminiResponse(sess.ID, resp)
	}
}

// processGeminiResponse handles a structured response from Gemini.
func (c *Controller) processGeminiResponse(sessionID string, resp *types.GeminiResponse) {
	if resp == nil {
		return
	}

	for _, h := range resp.Hazards {
		c.sessions.AddHazard(sessionID, h)
	}

	if c.hazards.ShouldAlert(resp.Hazards) && resp.VoiceResponse != "" {
		alertResp := c.responseMgr.HazardAlert(resp.VoiceResponse, resp.Hazards)
		if c.onResponse != nil {
			c.onResponse(sessionID, alertResp)
		}
	}
}

// --- Gemini Live session callbacks ---

func (c *Controller) handleGeminiText(sessionID, text string) {
	slog.Debug("gemini text response", "session_id", sessionID, "text", text)

	var resp types.GeminiResponse
	if err := json.Unmarshal([]byte(text), &resp); err == nil {
		c.processGeminiResponse(sessionID, &resp)
		return
	}

	if c.onResponse != nil {
		c.onResponse(sessionID, c.responseMgr.Voice(text))
	}
}

func (c *Controller) handleGeminiAudio(sessionID string, data []byte) {
	if c.onResponse != nil {
		c.onResponse(sessionID, &AgentResponse{
			Type:      "audio",
			AudioData: data,
		})
	}
}

func (c *Controller) handleGeminiToolCall(sessionID string, calls []*genai.FunctionCall) {
	slog.Info("gemini tool call", "session_id", sessionID, "count", len(calls))

	var responses []*genai.FunctionResponse

	for _, call := range calls {
		result := c.executeToolCall(sessionID, *call)
		responses = append(responses, &genai.FunctionResponse{
			ID:       call.ID,
			Name:     call.Name,
			Response: result,
		})
	}

	c.mu.RLock()
	ls, ok := c.liveSessions[sessionID]
	c.mu.RUnlock()

	if ok && ls.IsActive() {
		if err := ls.SendToolResponse(responses); err != nil {
			slog.Error("failed to send tool response", "session_id", sessionID, "error", err)
		}
	}
}

func (c *Controller) handleGeminiTranscript(sessionID, speaker, text string) {
	slog.Info("transcript",
		"session_id", sessionID,
		"speaker", speaker,
		"text", text,
	)

	if speaker == "user" && text != "" {
		intent := c.intentParser.Parse(text)
		if intent.Type != types.IntentConversation {
			resp := c.HandleIntent(sessionID, intent)
			if c.onResponse != nil {
				c.onResponse(sessionID, resp)
			}
		}
	}
}

// --- Tool execution ---

func (c *Controller) executeToolCall(sessionID string, call genai.FunctionCall) map[string]any {
	switch call.Name {
	case "inspect_frame":
		return c.toolInspectFrame(sessionID, call.Args)
	case "highlight_hazard":
		return c.toolHighlightHazard(sessionID, call.Args)
	case "switch_inspection_mode":
		return c.toolSwitchMode(sessionID, call.Args)
	case "generate_report":
		return c.toolGenerateReport(sessionID, call.Args)
	case "log_issue":
		return c.toolLogIssue(sessionID, call.Args)
	case "get_inspection_status":
		return c.toolGetStatus(sessionID)
	default:
		return map[string]any{"error": "unknown tool: " + call.Name}
	}
}

func (c *Controller) toolInspectFrame(sessionID string, args map[string]any) map[string]any {
	hazardsRaw, ok := args["hazards"]
	if !ok {
		return map[string]any{"status": "no hazards provided"}
	}

	hazardsJSON, err := json.Marshal(hazardsRaw)
	if err != nil {
		return map[string]any{"error": "invalid hazards format"}
	}

	var hazardInputs []struct {
		Description string  `json:"description"`
		Severity    string  `json:"severity"`
		Confidence  float64 `json:"confidence"`
		RuleID      string  `json:"rule_id"`
	}
	if err := json.Unmarshal(hazardsJSON, &hazardInputs); err != nil {
		return map[string]any{"error": "failed to parse hazards"}
	}

	sess, _ := c.sessions.Get(sessionID)
	camID := ""
	if sess != nil {
		camID = sess.CameraID
	}
	for _, h := range hazardInputs {
		c.sessions.AddHazard(sessionID, types.Hazard{
			ID:          sessionID + "_" + itoa(int(time.Now().UnixMilli())),
			RuleID:      h.RuleID,
			Description: h.Description,
			Severity:    types.Severity(h.Severity),
			Confidence:  h.Confidence,
			CameraID:    camID,
			DetectedAt:  time.Now(),
		})
	}

	return map[string]any{"status": "logged", "count": len(hazardInputs)}
}

func (c *Controller) toolHighlightHazard(sessionID string, args map[string]any) map[string]any {
	label, _ := args["label"].(string)
	severity, _ := args["severity"].(string)

	color := "#ffcc00"
	switch types.Severity(severity) {
	case types.SeverityCritical:
		color = "#ff0000"
	case types.SeverityHigh:
		color = "#ff4444"
	case types.SeverityMedium:
		color = "#ffaa00"
	}

	overlay := types.Overlay{
		Type:     "hazard_box",
		Label:    label,
		Severity: types.Severity(severity),
		Color:    color,
	}

	// Parse Gemini box_2d [ymin, xmin, ymax, xmax] (0-1000) → normalized 0-1
	if raw, ok := args["box_2d"]; ok {
		if arr, ok := raw.([]any); ok && len(arr) >= 4 {
			toF := func(v any) float64 {
				switch n := v.(type) {
				case float64:
					return n
				case int:
					return float64(n)
				default:
					return 0
				}
			}
			ymin := toF(arr[0]) / 1000.0
			xmin := toF(arr[1]) / 1000.0
			ymax := toF(arr[2]) / 1000.0
			xmax := toF(arr[3]) / 1000.0
			overlay.BBox = &types.BBox{
				X:      xmin,
				Y:      ymin,
				Width:  xmax - xmin,
				Height: ymax - ymin,
			}
		}
	}

	if c.onResponse != nil {
		c.onResponse(sessionID, &AgentResponse{
			Type:     "overlay",
			Overlays: []types.Overlay{overlay},
		})
	}

	return map[string]any{"status": "highlighted", "label": label}
}

func (c *Controller) toolSwitchMode(sessionID string, args map[string]any) map[string]any {
	mode, _ := args["mode"].(string)
	resp := c.switchMode(sessionID, mode)
	return map[string]any{"status": "switched", "mode": mode, "message": resp.Text}
}

func (c *Controller) toolGenerateReport(sessionID string, args map[string]any) map[string]any {
	format, _ := args["format"].(string)
	if format == "" {
		format = "json"
	}
	intent := types.AgentIntent{Type: types.IntentGenerateReport, Format: format}
	resp := c.generateReport(sessionID, intent)
	return map[string]any{"status": "generated", "message": resp.Text}
}

func (c *Controller) toolLogIssue(sessionID string, args map[string]any) map[string]any {
	desc, _ := args["description"].(string)
	sev, _ := args["severity"].(string)
	conf, _ := args["confidence"].(float64)
	ruleID, _ := args["rule_id"].(string)

	logSess, _ := c.sessions.Get(sessionID)
	logCamID := ""
	if logSess != nil {
		logCamID = logSess.CameraID
	}
	c.sessions.AddHazard(sessionID, types.Hazard{
		ID:          sessionID + "_" + itoa(int(time.Now().UnixMilli())),
		RuleID:      ruleID,
		Description: desc,
		Severity:    types.Severity(sev),
		Confidence:  conf,
		CameraID:    logCamID,
		DetectedAt:  time.Now(),
	})

	return map[string]any{"status": "logged", "description": desc}
}

func (c *Controller) toolGetStatus(sessionID string) map[string]any {
	sess, ok := c.sessions.Get(sessionID)
	if !ok {
		return map[string]any{"error": "no active session"}
	}

	return map[string]any{
		"mode":         sess.InspectionMode,
		"hazard_count": len(sess.Hazards),
		"risk_score":   c.hazards.CalculateRiskScore(sess.Hazards),
		"risk_level":   string(c.hazards.CalculateRiskLevel(sess.Hazards)),
		"state":        string(sess.State),
	}
}
