"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedGrid } from "./FeedGrid";
import { ArgusIndicator } from "@/components/ArgusIndicator";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { INSPECTION_MODES, modeLabel } from "@/lib/modes";
import { resolveVoiceIntent } from "@/lib/voiceIntent";
import type { GlassMode } from "@/components/HazardOverlay";
import type { ActionCard, Hazard, Overlay } from "@/lib/types";

interface CCTVSessionProps {
  session: {
    connected: boolean;
    isInspecting: boolean;
    hazards: Hazard[];
    overlays: Overlay[];
    actionCards: ActionCard[];
    riskLevel: string;
    processing: boolean;
    speaking: boolean;
    sendFrame: (blob: Blob) => void;
    startInspection: (mode: string) => void;
    stopInspection: () => void;
    generateReport: () => void;
    requestActions: () => void;
    sendNaturalLanguageCommand?: (text: string) => void;
  };
  mode: string;
  onModeChange: (mode: string) => void;
  overlaysVisible?: boolean;
  videoSource?: string | null;
  glassMode?: GlassMode;
  onGlassModeChange?: (mode: GlassMode) => void;
  voiceInputEnabled: boolean;
  voiceOutputEnabled: boolean;
  onVoiceInputChange: (enabled: boolean) => void;
  onVoiceOutputChange: (enabled: boolean) => void;
}

const SEVERITY_COLOR: Record<string, string> = {
  low:      "#22c55e",
  medium:   "#f59e0b",
  high:     "#ef4444",
  critical: "#ef4444",
};

const RISK_COLOR: Record<string, string> = {
  low:      "#22c55e",
  medium:   "#f59e0b",
  high:     "#ef4444",
  critical: "#ef4444",
};

export function CCTVSession({
  session,
  mode,
  onModeChange,
  overlaysVisible = true,
  videoSource,
  glassMode: externalGlassMode,
  onGlassModeChange,
  voiceInputEnabled,
  voiceOutputEnabled,
  onVoiceInputChange,
  onVoiceOutputChange,
}: CCTVSessionProps) {
  const [activeFeed, setActiveFeed] = useState(0);
  const [time, setTime]             = useState("");
  const [localGlassMode, setLocalGlassMode] = useState<GlassMode>("dark");
  const glassMode = externalGlassMode ?? localGlassMode;

  const setGlassMode = useCallback(
    (next: GlassMode) => {
      if (onGlassModeChange) onGlassModeChange(next);
      else setLocalGlassMode(next);
    },
    [onGlassModeChange]
  );

  const indicatorState = session.speaking
    ? "speaking"
    : session.processing
    ? "processing"
    : "idle";

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "i")
        session.isInspecting ? session.stopInspection() : session.startInspection(mode);
      if (e.key === "r") session.generateReport();
      if (e.key === "1") setActiveFeed(0);
      if (e.key === "2") setActiveFeed(1);
      if (e.key === "3") setActiveFeed(2);
      if (e.key === "4") setActiveFeed(3);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, mode]);

  const handleVoiceCommand = useCallback(
    (transcript: string) => {
      const intent = resolveVoiceIntent(transcript);
      switch (intent.type) {
        case "start_inspection":
          session.startInspection(mode);
          break;
        case "stop_inspection":
          session.stopInspection();
          break;
        case "generate_report":
          session.generateReport();
          break;
        case "operator_actions":
          session.requestActions();
          break;
        case "switch_mode":
          if (intent.mode) {
            const matched = INSPECTION_MODES.find((m) => m === intent.mode);
            if (matched) onModeChange(matched);
          }
          break;
        case "set_glass_light":
          setGlassMode("light");
          break;
        case "set_glass_dark":
          setGlassMode("dark");
          break;
        default:
          session.sendNaturalLanguageCommand?.(transcript);
          break;
      }
    },
    [session, mode, onModeChange, setGlassMode]
  );

  const { supported: voiceInputSupported } = useVoiceCommands({
    onCommand: handleVoiceCommand,
    enabled: voiceInputEnabled,
  });

  const riskColor = RISK_COLOR[session.riskLevel] ?? "#4a4a4a";
  const hazardStr = session.hazards.length.toString().padStart(2, "0");

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: "#000" }}>
      {/* Top bar — single line */}
      <header
        className="h-9 flex items-center justify-between px-5 shrink-0 liquid-glass"
        style={{ borderBottom: "1px solid #1c1c1c" }}
      >
        <div className="flex items-center gap-3">
          <span className="font-display text-xs font-bold tracking-[0.25em] uppercase liquid-title">
            ARGUS
          </span>
          <span className="liquid-meta" style={{ fontSize: 10 }}>|</span>
          <span className="font-mono text-xs tracking-[0.15em] uppercase liquid-meta">
            CCTV
          </span>
        </div>
        <div className="flex items-center gap-4">
          <ArgusIndicator state={indicatorState} />
          <div className="flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: session.connected ? "#FF5F1F" : "#1c1c1c" }}
            />
            <span className="font-mono text-xs" style={{ color: session.connected ? "#FF5F1F" : "#4a4a4a" }}>
              {session.connected ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          <span className="font-mono text-xs liquid-meta">{time}</span>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Feed grid */}
        <div className="flex-1 overflow-hidden">
          <FeedGrid
            overlays={session.overlays}
            overlaysVisible={overlaysVisible}
            glassMode={glassMode}
            videoSource={videoSource}
            onFrame={session.sendFrame}
            activeFeed={activeFeed}
            onSelectFeed={setActiveFeed}
          />
        </div>

        {/* Sidebar */}
        <aside
          className="w-52 flex flex-col overflow-hidden shrink-0 liquid-glass"
          style={{ background: "#080808", borderLeft: "1px solid #1c1c1c" }}
        >
          {/* Risk */}
          <div className="px-5 pt-6 pb-4" style={{ borderBottom: "1px solid #1c1c1c" }}>
            <p className="font-mono text-xs tracking-[0.2em] uppercase mb-2 liquid-meta">
              Risk Level
            </p>
            <p
              className="font-display text-xl font-bold uppercase leading-none tracking-tight"
              style={{ color: riskColor }}
            >
              {session.riskLevel}
            </p>
          </div>

          {/* Hazard count */}
          <div className="px-5 pt-4 pb-4" style={{ borderBottom: "1px solid #1c1c1c" }}>
            <p className="font-mono text-xs tracking-[0.2em] uppercase mb-1 liquid-meta">
              Hazards
            </p>
            <p className="font-mono font-normal leading-none liquid-title" style={{ fontSize: 36 }}>
              {hazardStr}
            </p>
          </div>

          {/* Mode */}
          <div className="px-5 pt-4 pb-3" style={{ borderBottom: "1px solid #1c1c1c" }}>
            <p className="font-mono text-xs tracking-[0.2em] uppercase mb-2 liquid-meta">
              Mode
            </p>
            <select
              value={mode}
              onChange={(e) => onModeChange(e.target.value)}
              className="w-full liquid-glass liquid-float liquid-pill font-mono text-xs tracking-wider uppercase py-2 px-2.5 bg-transparent appearance-none cursor-pointer transition-colors duration-100 focus:outline-none liquid-title"
            >
              {INSPECTION_MODES.map((m) => (
                <option
                  key={m}
                  value={m}
                  style={{ background: "#080808", color: m === mode ? "#FF5F1F" : "#f0f0f0" }}
                >
                  {modeLabel(m)}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="px-5 py-4" style={{ borderBottom: "1px solid #1c1c1c" }}>
            <div className="grid grid-cols-2 gap-1.5 mb-1.5">
              <button
                onClick={() => onVoiceInputChange(!voiceInputEnabled)}
                disabled={!voiceInputSupported}
                className="liquid-glass liquid-float liquid-pill font-display text-[10px] font-medium tracking-[0.12em] uppercase py-2 transition-colors duration-100"
                style={{
                  color: !voiceInputSupported
                    ? "#2a2a2a"
                    : voiceInputEnabled
                    ? "#FF5F1F"
                    : "#4a4a4a",
                  opacity: voiceInputSupported ? 1 : 0.6,
                }}
              >
                IN {voiceInputEnabled ? "ON" : "OFF"}
              </button>
              <button
                onClick={() => onVoiceOutputChange(!voiceOutputEnabled)}
                className="liquid-glass liquid-float liquid-pill font-display text-[10px] font-medium tracking-[0.12em] uppercase py-2 transition-colors duration-100"
                style={{
                  color: voiceOutputEnabled ? "#FF5F1F" : "#4a4a4a",
                }}
              >
                OUT {voiceOutputEnabled ? "ON" : "OFF"}
              </button>
            </div>
            <button
              onClick={() =>
                session.isInspecting ? session.stopInspection() : session.startInspection(mode)
              }
              className="w-full liquid-glass liquid-float liquid-pill font-display text-xs font-bold tracking-[0.2em] uppercase py-3 transition-colors duration-100"
              style={
                session.isInspecting
                  ? { color: "#ef4444" }
                  : { color: "#FF5F1F" }
              }
            >
              {session.isInspecting ? "■  STOP" : "INSPECT"}
            </button>
            <button
              onClick={session.generateReport}
              className="w-full liquid-glass liquid-float liquid-pill font-display text-xs font-medium tracking-[0.15em] uppercase py-2 mt-1.5 transition-colors duration-100 liquid-meta"
            >
              REPORT
            </button>
            <button
              onClick={session.requestActions}
              className="w-full liquid-glass liquid-float liquid-pill font-display text-xs font-medium tracking-[0.15em] uppercase py-2 mt-1.5 transition-colors duration-100 liquid-meta"
            >
              TOP 3 ACTIONS
            </button>
          </div>

          {/* Hazard log */}
          <div className="flex-1 overflow-y-auto">
            {session.hazards.length === 0 ? (
              <div className="px-5 py-4">
                <span className="font-mono text-xs liquid-meta">—</span>
              </div>
            ) : (
              session.hazards.map((h) => (
                <div key={h.id} className="px-5 py-3" style={{ borderBottom: "1px solid #1c1c1c" }}>
                  <p className="font-sans text-xs font-light leading-relaxed liquid-title">
                    {h.description}
                  </p>
                  <span
                    className="font-mono text-xs uppercase tracking-widest"
                    style={{ color: SEVERITY_COLOR[h.severity] ?? "#4a4a4a" }}
                  >
                    {h.severity} • {Math.round(h.confidence * 100)}%
                  </span>
                  <p className="font-mono text-[10px] mt-1 liquid-meta">
                    {h.rule_id || "rule:n/a"} • {h.camera_id || "camera:n/a"} • {h.persistence_seconds ?? 0}s • {h.risk_trend || "new"}
                  </p>
                </div>
              ))
            )}
          </div>

          {session.actionCards.length > 0 && (
            <div className="px-5 py-3 liquid-glass">
              <p className="font-mono text-[9px] tracking-[0.16em] uppercase mb-1.5 liquid-meta">
                ACTION CARDS
              </p>
              <div className="space-y-1.5">
                {session.actionCards.slice(0, 3).map((card, idx) => (
                  <div key={`${card.hazard_ref_id ?? card.title}-${idx}`} className="px-2 py-1.5 liquid-glass">
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] liquid-meta">
                      {card.priority}
                    </p>
                    <p className="font-sans text-xs mt-0.5 liquid-title">
                      {card.title}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Keyboard shortcuts */}
          <div className="px-5 py-3" style={{ borderTop: "1px solid #1c1c1c" }}>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {[["I", "inspect"], ["R", "report"], ["O", "overlays"], ["1–4", "feed"]].map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <kbd
                    className="font-mono text-xs px-1 py-px"
                    style={{ color: "#4a4a4a", border: "1px solid #1c1c1c", background: "#000" }}
                  >
                    {k}
                  </kbd>
                  <span className="font-sans text-xs font-light" style={{ color: "#2a2a2a" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
