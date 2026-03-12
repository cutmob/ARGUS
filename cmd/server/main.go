package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/cutmob/argus/internal/agent"
	"github.com/cutmob/argus/internal/gemini"
	"github.com/cutmob/argus/internal/inspection"
	"github.com/cutmob/argus/internal/integrations"
	"github.com/cutmob/argus/internal/reporting"
	"github.com/cutmob/argus/internal/session"
	"github.com/cutmob/argus/internal/streaming"
	"github.com/cutmob/argus/internal/vision"
	"github.com/cutmob/argus/pkg/types"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg := loadConfig()
	validateConfig(cfg)

	ctx := context.Background()

	// Initialize Gemini client (official google.golang.org/genai SDK)
	geminiClient, err := gemini.NewClient(ctx)
	if err != nil {
		slog.Error("failed to initialize gemini client", "error", err)
		os.Exit(1)
	}

	// Core services
	sessionMgr := session.NewManager()
	moduleLoader := inspection.NewModuleLoader(cfg.ModulesDir)
	ruleEngine := inspection.NewRuleEngine(moduleLoader)
	hazardDetector := inspection.NewHazardDetector(ruleEngine)

	// Vision pipeline
	frameSampler := vision.NewFrameSampler(cfg.Vision.SampleIntervalMs)
	eventEngine := vision.NewEventEngine(hazardDetector)
	detector := vision.NewDetector(frameSampler, eventEngine)

	// Reporting & integrations
	webhookClient := integrations.NewWebhookClient()
	exportRegistry := reporting.NewExportRegistry()
	exportRegistry.Register("json", reporting.NewJSONExporter())
	exportRegistry.Register("txt", reporting.NewTXTExporter())
	exportRegistry.Register("csv", reporting.NewCSVExporter())
	exportRegistry.Register("html", reporting.NewHTMLExporter())
	exportRegistry.Register("word", reporting.NewWordExporter())
	exportRegistry.Register("doc", reporting.NewWordExporter())
	exportRegistry.Register("pdf", reporting.NewPDFExporter())
	exportRegistry.Register("webhook", reporting.NewWebhookExporter(webhookClient))

	reportBuilder := reporting.NewReportBuilder(exportRegistry)

	// WebSocket streaming server (declared early so agent can reference it)
	var wsServer *streaming.WebSocketServer

	// Agent brain — wired to Gemini Live + all subsystems
	agentCtrl := agent.NewController(agent.ControllerConfig{
		SessionManager: sessionMgr,
		RuleEngine:     ruleEngine,
		HazardDetector: hazardDetector,
		Detector:       detector,
		ReportBuilder:  reportBuilder,
		ModuleLoader:   moduleLoader,
		GeminiClient:   geminiClient,
		OnResponse: func(sessionID string, resp *agent.AgentResponse) {
			if wsServer == nil {
				return
			}
			// Forward agent responses back to the client over WebSocket
			msg := streaming.AgentResponseToWSMessage(sessionID, resp)
			if err := wsServer.Send(sessionID, msg); err != nil {
				slog.Error("failed to send response to client",
					"session_id", sessionID,
					"error", err,
				)
			}
		},
	})

	// WebSocket streaming server
	wsServer = streaming.NewWebSocketServer(streaming.Config{
		OnFrame: agentCtrl.HandleFrame,
		OnAudio: agentCtrl.HandleAudio,
		OnEvent: agentCtrl.HandleEvent,
		OnCommand: func(sessionID string, msg types.WebSocketMessage) {
			intent := types.AgentIntent{RawText: msg.Type, Parameters: map[string]string{}}
			var payload map[string]any
			if msg.Payload != nil {
				if raw, err := json.Marshal(msg.Payload); err == nil {
					_ = json.Unmarshal(raw, &payload)
				}
			}
			switch msg.Type {
			case "start_inspection":
				intent.Type = types.IntentStartInspection
				if mode, ok := payload["mode"].(string); ok {
					intent.Mode = mode
				}
			case "stop_inspection":
				intent.Type = types.IntentStopInspection
			case "switch_mode":
				intent.Type = types.IntentSwitchMode
				if mode, ok := payload["mode"].(string); ok {
					intent.Mode = mode
				}
			case "generate_report":
				intent.Type = types.IntentGenerateReport
				if format, ok := payload["format"].(string); ok {
					intent.Format = format
				}
			case "operator_actions":
				intent.Type = types.IntentOperatorActions
			case "voice_command":
				if text, ok := payload["text"].(string); ok && text != "" {
					resp := agentCtrl.HandleRawText(sessionID, text)
					if resp != nil {
						msg := streaming.AgentResponseToWSMessage(sessionID, resp)
						if err := wsServer.Send(sessionID, msg); err != nil {
							slog.Error("failed to send natural language response", "session_id", sessionID, "error", err)
						}
					}
				}
				return
			default:
				return
			}
			resp := agentCtrl.HandleIntent(sessionID, intent)
			if resp != nil {
				msg := streaming.AgentResponseToWSMessage(sessionID, resp)
				if err := wsServer.Send(sessionID, msg); err != nil {
					slog.Error("failed to send command response", "session_id", sessionID, "error", err)
				}
			}
		},
		SessionManager: sessionMgr,
		DemoTokens:     cfg.DemoTokens,
	})

	// HTTP routes
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", wsServer.HandleConnection)
	mux.HandleFunc("/api/v1/sessions", sessionMgr.HandleListSessions)
	mux.HandleFunc("/api/v1/sessions/", sessionMgr.HandleGetSession)
	mux.HandleFunc("/api/v1/modules", moduleLoader.HandleListModules)
	mux.HandleFunc("/api/v1/reports", reportBuilder.HandleCreateReport)
	mux.HandleFunc("/api/v1/reports/", reportBuilder.HandleGetReport)
	mux.HandleFunc("/api/v1/health", handleHealth)

	handler := corsMiddleware(mux)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("ARGUS server starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down ARGUS server")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sessionMgr.CloseAll()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("forced shutdown", "error", err)
	}
	slog.Info("ARGUS server stopped")
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(`{"status":"healthy","service":"argus"}`)); err != nil {
		slog.Error("failed to write health response", "error", err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type Config struct {
	Port       string
	ModulesDir string
	GeminiKey  string
	DemoTokens map[string]bool
	Vision     VisionConfig
}

type VisionConfig struct {
	SampleIntervalMs int
}

func loadConfig() Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	modulesDir := os.Getenv("ARGUS_MODULES_DIR")
	if modulesDir == "" {
		modulesDir = "./modules"
	}
	// DEMO_TOKENS is a comma-separated list of valid access codes, e.g. "ARGUS-A1,ARGUS-B2"
	demoTokens := map[string]bool{}
	if raw := os.Getenv("DEMO_TOKENS"); raw != "" {
		for _, t := range strings.Split(raw, ",") {
			if t = strings.TrimSpace(t); t != "" {
				demoTokens[t] = true
			}
		}
	}

	return Config{
		Port:       port,
		ModulesDir: modulesDir,
		GeminiKey:  os.Getenv("GEMINI_API_KEY"),
		DemoTokens: demoTokens,
		Vision: VisionConfig{
			SampleIntervalMs: 3000,
		},
	}
}

func validateConfig(cfg Config) {
	if cfg.GeminiKey == "" {
		slog.Warn("GEMINI_API_KEY not set — Gemini features will fail at runtime")
	}

	if _, err := os.Stat(cfg.ModulesDir); os.IsNotExist(err) {
		slog.Error("modules directory does not exist", "dir", cfg.ModulesDir)
		os.Exit(1)
	}

	modules, err := os.ReadDir(cfg.ModulesDir)
	if err != nil {
		slog.Error("cannot read modules directory", "dir", cfg.ModulesDir, "error", err)
		os.Exit(1)
	}

	moduleCount := 0
	for _, m := range modules {
		if m.IsDir() {
			moduleCount++
		}
	}

	if moduleCount == 0 {
		slog.Warn("no inspection modules found", "dir", cfg.ModulesDir)
	}

	slog.Info("config validated",
		"port", cfg.Port,
		"modules_dir", cfg.ModulesDir,
		"modules_found", moduleCount,
		"gemini_key_set", cfg.GeminiKey != "",
	)
}
