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
	// Latest Gemini model supporting the Live API (bidirectional streaming).
	defaultLiveModel = "gemini-2.5-flash-native-audio-preview-12-2025"

	// Standard content model for one-shot frame analysis.
	defaultContentModel = "gemini-2.5-flash"
)

// Client wraps the official Google GenAI SDK for both standard
// GenerateContent calls and Live API bidirectional streaming sessions.
type Client struct {
	inner        *genai.Client
	liveModel    string
	contentModel string
}

// NewClient creates a Gemini client using the official google.golang.org/genai SDK.
func NewClient(ctx context.Context) (*Client, error) {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY environment variable is required")
	}

	inner, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("creating genai client: %w", err)
	}

	liveModel := os.Getenv("GEMINI_LIVE_MODEL")
	if liveModel == "" {
		liveModel = defaultLiveModel
	}
	contentModel := os.Getenv("GEMINI_CONTENT_MODEL")
	if contentModel == "" {
		contentModel = defaultContentModel
	}

	slog.Info("gemini client initialized",
		"live_model", liveModel,
		"content_model", contentModel,
	)

	return &Client{
		inner:        inner,
		liveModel:    liveModel,
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
		Temperature:      genai.Ptr(float32(0.2)),
		MaxOutputTokens:  2048,
		ResponseMIMEType: "application/json",
		ResponseJsonSchema: hazardResponseSchema(),
	}

	result, err := c.inner.Models.GenerateContent(ctx, c.contentModel,
		[]*genai.Content{{Parts: parts}}, config)
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

// Inner returns the underlying genai.Client for Live API access.
func (c *Client) Inner() *genai.Client {
	return c.inner
}

// LiveModel returns the configured Live API model name.
func (c *Client) LiveModel() string {
	return c.liveModel
}

// ContentModel returns the configured content model name.
func (c *Client) ContentModel() string {
	return c.contentModel
}
