package inspection

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/cutmob/argus/pkg/types"
)

// ModuleLoader discovers, loads, and manages pluggable inspection modules.
// Each module is a directory containing rules.json, prompts.yaml, and metadata.json.
type ModuleLoader struct {
	mu         sync.RWMutex
	modulesDir string
	cache      map[string]*types.InspectionModule
}

func NewModuleLoader(modulesDir string) *ModuleLoader {
	ml := &ModuleLoader{
		modulesDir: modulesDir,
		cache:      make(map[string]*types.InspectionModule),
	}
	ml.discoverModules()
	return ml
}

// Load returns a loaded module by name. Loads from disk if not cached.
func (ml *ModuleLoader) Load(name string) (*types.InspectionModule, error) {
	ml.mu.RLock()
	if mod, ok := ml.cache[name]; ok {
		ml.mu.RUnlock()
		return mod, nil
	}
	ml.mu.RUnlock()

	return ml.loadFromDisk(name)
}

// ListAvailable returns names of all discovered modules.
func (ml *ModuleLoader) ListAvailable() []string {
	ml.mu.RLock()
	defer ml.mu.RUnlock()

	names := make([]string, 0, len(ml.cache))
	for name := range ml.cache {
		names = append(names, name)
	}
	return names
}

// Reload refreshes the module cache from disk.
func (ml *ModuleLoader) Reload() {
	ml.mu.Lock()
	ml.cache = make(map[string]*types.InspectionModule)
	ml.mu.Unlock()
	ml.discoverModules()
}

// HandleListModules returns available modules as JSON.
func (ml *ModuleLoader) HandleListModules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ml.mu.RLock()
	modules := make([]*types.InspectionModule, 0, len(ml.cache))
	for _, mod := range ml.cache {
		modules = append(modules, mod)
	}
	ml.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"modules": modules,
		"count":   len(modules),
	})
}

func (ml *ModuleLoader) discoverModules() {
	entries, err := os.ReadDir(ml.modulesDir)
	if err != nil {
		slog.Warn("could not read modules directory", "dir", ml.modulesDir, "error", err)
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if _, err := ml.loadFromDisk(name); err != nil {
			slog.Warn("failed to load module", "name", name, "error", err)
		} else {
			slog.Info("module loaded", "name", name)
		}
	}
}

func (ml *ModuleLoader) loadFromDisk(name string) (*types.InspectionModule, error) {
	moduleDir := filepath.Join(ml.modulesDir, name)

	// Load rules
	rulesPath := filepath.Join(moduleDir, "rules.json")
	rulesData, err := os.ReadFile(rulesPath)
	if err != nil {
		return nil, fmt.Errorf("reading rules for %s: %w", name, err)
	}

	var rules []types.InspectionRule
	if err := json.Unmarshal(rulesData, &rules); err != nil {
		return nil, fmt.Errorf("parsing rules for %s: %w", name, err)
	}

	// Enable all rules by default
	for i := range rules {
		if rules[i].RuleID == "" {
			rules[i].RuleID = fmt.Sprintf("%s_%03d", name, i+1)
		}
		rules[i].Enabled = true
	}

	// Load metadata
	var metadata types.ModuleMetadata
	metaPath := filepath.Join(moduleDir, "metadata.json")
	if metaData, err := os.ReadFile(metaPath); err == nil {
		if err := json.Unmarshal(metaData, &metadata); err != nil {
			slog.Warn("invalid metadata.json", "module", name, "error", err)
		}
	}

	// Load system prompt
	systemPrompt := ""
	promptPath := filepath.Join(moduleDir, "prompt.txt")
	if promptData, err := os.ReadFile(promptPath); err == nil {
		systemPrompt = string(promptData)
	}

	mod := &types.InspectionModule{
		Name:         name,
		Version:      metadata.Version,
		Description:  name + " inspection module (" + fmt.Sprintf("%d", len(rules)) + " rules)",
		Rules:        rules,
		SystemPrompt: systemPrompt,
		Metadata:     metadata,
	}

	if mod.Version == "" {
		mod.Version = "1"
	}

	ml.mu.Lock()
	ml.cache[name] = mod
	ml.mu.Unlock()

	return mod, nil
}
