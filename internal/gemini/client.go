package gemini

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"google.golang.org/genai"

	"github.com/cutmob/argus/pkg/types"
)

const (
	// Stable native audio model for the Live API on Vertex AI.
	// GA model with robust function calling support.
	// Override via GEMINI_LIVE_MODEL env var if needed.
	defaultLiveModel = "gemini-live-2.5-flash-native-audio"

	// Live model alias for the Gemini Developer API (AI Studio) backend.
	// This backend supports NON_BLOCKING function declarations, unlike Vertex AI.
	// Using the stable "latest" alias — the December preview has known 1008 bugs.
	defaultLiveModelGeminiAPI = "gemini-2.5-flash-native-audio-latest"

	// Standard content model for one-shot frame analysis.
	defaultContentModel = "gemini-2.5-flash"
)

// Client wraps the official Google GenAI SDK for both standard
// GenerateContent calls and Live API bidirectional streaming sessions.
type Client struct {
	inner        *genai.Client
	// liveInner is a dedicated Gemini API client for Live sessions.
	// It supports NON_BLOCKING function declarations, which Vertex AI does not.
	// Falls back to inner if no GEMINI_API_KEY is set.
	liveInner    *genai.Client
	liveModel    string
	contentModel string
}

// NewClient creates a Gemini client using the official google.golang.org/genai SDK.
// Supports two backends:
//   - Vertex AI (default): set GCP_PROJECT_ID and GCP_LOCATION env vars.
//     Uses Application Default Credentials (ADC) — run `gcloud auth application-default login`
//     locally, or deploy to Cloud Run with a service account.
//   - Gemini API (AI Studio): set GEMINI_API_KEY and GEMINI_BACKEND=gemini_api.
func NewClient(ctx context.Context) (*Client, error) {
	var inner *genai.Client
	var err error
	var backendName string

	if os.Getenv("GEMINI_BACKEND") == "gemini_api" {
		// Legacy Gemini API (AI Studio) backend
		apiKey := os.Getenv("GEMINI_API_KEY")
		if apiKey == "" {
			return nil, fmt.Errorf("GEMINI_API_KEY is required when GEMINI_BACKEND=gemini_api")
		}
		inner, err = genai.NewClient(ctx, &genai.ClientConfig{
			APIKey:  apiKey,
			Backend: genai.BackendGeminiAPI,
			HTTPOptions: genai.HTTPOptions{
				APIVersion: "v1alpha",
			},
		})
		backendName = "gemini_api"
	} else {
		// Vertex AI backend (default) — uses ADC, no API key needed
		project := os.Getenv("GCP_PROJECT_ID")
		location := os.Getenv("GCP_LOCATION")
		if project == "" {
			return nil, fmt.Errorf("GCP_PROJECT_ID environment variable is required (or set GEMINI_BACKEND=gemini_api to use AI Studio)")
		}
		if location == "" {
			location = "us-central1"
		}
		inner, err = genai.NewClient(ctx, &genai.ClientConfig{
			Project:  project,
			Location: location,
			Backend:  genai.BackendVertexAI,
			HTTPOptions: genai.HTTPOptions{
				APIVersion: "v1beta1",
			},
		})
		backendName = "vertex_ai"
	}
	if err != nil {
		return nil, fmt.Errorf("creating genai client: %w", err)
	}

	liveModel := os.Getenv("GEMINI_LIVE_MODEL")
	if liveModel == "" {
		if backendName == "gemini_api" {
			liveModel = defaultLiveModelGeminiAPI
		} else {
			liveModel = defaultLiveModel
		}
	}
	contentModel := os.Getenv("GEMINI_CONTENT_MODEL")
	if contentModel == "" {
		contentModel = defaultContentModel
	}

	// Build a dedicated Gemini Developer API client for Live sessions so we can
	// use NON_BLOCKING function declarations (not supported on Vertex AI).
	// If GEMINI_API_KEY is present we always use this for Live, regardless of
	// which backend is used for GenerateContent.
	var liveInner *genai.Client
	liveModel_ := liveModel
	if apiKey := os.Getenv("GEMINI_API_KEY"); apiKey != "" && backendName != "gemini_api" {
		liveInner, err = genai.NewClient(ctx, &genai.ClientConfig{
			APIKey:  apiKey,
			Backend: genai.BackendGeminiAPI,
			HTTPOptions: genai.HTTPOptions{
				APIVersion: "v1alpha",
			},
		})
		if err != nil {
			slog.Warn("failed to create Gemini API live client, falling back to primary backend",
				"error", err,
			)
			liveInner = nil
		} else {
			// Use the Gemini API model alias for this client
			if os.Getenv("GEMINI_LIVE_MODEL") == "" {
				liveModel_ = defaultLiveModelGeminiAPI
			}
			slog.Info("gemini live client: using Gemini API backend (NON_BLOCKING supported)",
				"live_model", liveModel_,
			)
		}
	}
	if liveInner == nil {
		liveInner = inner
	}

	slog.Info("gemini client initialized",
		"backend", backendName,
		"live_model", liveModel_,
		"content_model", contentModel,
	)

	return &Client{
		inner:        inner,
		liveInner:    liveInner,
		liveModel:    liveModel_,
		contentModel: contentModel,
	}, nil
}

// AnalyzeFrame sends a single frame + rules to Gemini for vision reasoning
// using the standard GenerateContent API (one-shot, not Live).
func (c *Client) AnalyzeFrame(ctx context.Context, req types.GeminiRequest) (*types.GeminiResponse, error) {
	parts := []*genai.Part{}

	// Image goes first for optimal results per Google's docs.
	if req.Frame != nil && len(req.Frame.Data) > 0 {
		mimeType := "image/jpeg"
		if req.Frame.Format == "png" {
			mimeType = "image/png"
		}
		parts = append(parts, &genai.Part{
			InlineData: &genai.Blob{
				Data:     req.Frame.Data,
				MIMEType: mimeType,
			},
		})
	}

	prompt := req.Prompt
	if prompt == "" {
		prompt = buildAnalysisPrompt(req)
	}
	parts = append(parts, genai.NewPartFromText(prompt))

	config := &genai.GenerateContentConfig{
		Temperature:        genai.Ptr(float32(0.2)),
		MaxOutputTokens:    2048,
		ResponseMIMEType:   "application/json",
		ResponseJsonSchema: hazardResponseSchema(),
	}

	result, err := c.inner.Models.GenerateContent(ctx, c.contentModel,
		[]*genai.Content{{Role: "user", Parts: parts}}, config)
	if err != nil {
		return nil, fmt.Errorf("gemini GenerateContent: %w", err)
	}

	return parseGenerateContentResponse(result)
}

// AnalyzeText sends a text-only query to Gemini.
func (c *Client) AnalyzeText(ctx context.Context, prompt string, systemContext string) (*types.GeminiResponse, error) {
	fullPrompt := prompt
	if systemContext != "" {
		fullPrompt = systemContext + "\n\n" + prompt
	}

	result, err := c.inner.Models.GenerateContent(ctx, c.contentModel,
		genai.Text(fullPrompt), &genai.GenerateContentConfig{
			Temperature:     genai.Ptr(float32(0.3)),
			MaxOutputTokens: 1024,
		})
	if err != nil {
		return nil, fmt.Errorf("gemini text analysis: %w", err)
	}

	return parseGenerateContentResponse(result)
}

// Inner returns the underlying genai.Client for GenerateContent calls.
func (c *Client) Inner() *genai.Client {
	return c.inner
}

// LiveInner returns the genai.Client to use for Live API sessions.
// This is the Gemini Developer API client when available (supports NON_BLOCKING),
// falling back to the primary client otherwise.
func (c *Client) LiveInner() *genai.Client {
	return c.liveInner
}

// LiveModel returns the configured Live API model name.
func (c *Client) LiveModel() string {
	return c.liveModel
}

// ContentModel returns the configured content model name.
func (c *Client) ContentModel() string {
	return c.contentModel
}
