"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedGrid } from "./FeedGrid";
import { ArgusIndicator } from "@/components/ArgusIndicator";
import { INSPECTION_MODES, modeLabel } from "@/lib/modes";
import { useCameraDevices } from "@/hooks/useCameraDevices";
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
    clearHazards: () => void;
  };
  mode: string;
  onModeChange: (mode: string) => void;
  overlaysVisible?: boolean;
  overlaysFading?: boolean;
  videoSource?: string | null;
  videoFile?: File | null;
  glassMode?: GlassMode;
  onGlassModeChange?: (mode: GlassMode) => void;
  voiceOutputEnabled: boolean;
  onVoiceOutputChange: (enabled: boolean) => void;
  /** Whether live audio input is currently active (always-on when inspecting). */
  audioInputActive: boolean;
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

// Theme tokens keyed by glass mode
const T = {
  dark: {
    pageBg: "#000",
    sidebarBg: "#080808",
    border: "#1c1c1c",
    offlineDot: "#1c1c1c",
    inactive: "#4a4a4a",
    optionBg: "#080808",
    optionText: "#f0f0f0",
    kbdBg: "#000",
    kbdBorder: "#1c1c1c",
    kbdLabel: "#2a2a2a",
    chevron: "#4a4a4a",
  },
  light: {
    pageBg: "#f5f5f5",
    sidebarBg: "rgba(255,255,255,0.82)",
    border: "rgba(0,0,0,0.1)",
    offlineDot: "#ccc",
    inactive: "#999",
    optionBg: "#fff",
    optionText: "#222",
    kbdBg: "#fff",
    kbdBorder: "rgba(0,0,0,0.12)",
    kbdLabel: "#aaa",
    chevron: "#999",
  },
};

export function CCTVSession({
  session,
  mode,
  onModeChange,
  overlaysVisible = true,
  overlaysFading = false,
  videoSource,
  videoFile,
  glassMode: externalGlassMode,
  onGlassModeChange,
  voiceOutputEnabled,
  onVoiceOutputChange,
  audioInputActive,
}: CCTVSessionProps) {
  const [activeFeed, setActiveFeed] = useState(0);
  const [time, setTime]             = useState("");
  const [localGlassMode, setLocalGlassMode] = useState<GlassMode>("dark");
  const [expandedHazards, setExpandedHazards] = useState<Set<string>>(new Set());
  const { devices: cameraDevices, selectedId: selectedCamera, selectDevice: selectCamera } = useCameraDevices();
  const glassMode = externalGlassMode ?? localGlassMode;
  const t = T[glassMode];

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

  const riskColor = RISK_COLOR[session.riskLevel] ?? t.inactive;
  const hazardStr = session.hazards.length.toString().padStart(2, "0");

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: t.pageBg }}>
      {/* Top bar */}
      <header
        className="h-9 flex items-center justify-between px-5 shrink-0 liquid-glass"
        style={{ borderBottom: `1px solid ${t.border}` }}
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
              style={{ background: session.connected ? "#FF5F1F" : t.offlineDot }}
            />
            <span className="font-mono text-xs" style={{ color: session.connected ? "#FF5F1F" : t.inactive }}>
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
            hazards={session.hazards}
            overlays={session.overlays}
            overlaysVisible={overlaysVisible}
            overlaysFading={overlaysFading}
            glassMode={glassMode}
            videoSource={videoSource}
            videoFile={videoFile}
            deviceId={selectedCamera}
            onFrame={session.sendFrame}
            activeFeed={activeFeed}
            onSelectFeed={setActiveFeed}
          />
        </div>

        {/* Sidebar */}
        <aside
          className="w-52 flex flex-col overflow-hidden shrink-0 liquid-glass"
          style={{ background: t.sidebarBg, borderLeft: `1px solid ${t.border}` }}
        >
          {/* Risk */}
          <div className="px-5 pt-6 pb-4" style={{ borderBottom: `1px solid ${t.border}` }}>
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
          <div className="px-5 pt-4 pb-4" style={{ borderBottom: `1px solid ${t.border}` }}>
            <p className="font-mono text-xs tracking-[0.2em] uppercase mb-1 liquid-meta">
              Hazards
            </p>
            <p className="font-mono font-normal leading-none liquid-title" style={{ fontSize: 36 }}>
              {hazardStr}
            </p>
          </div>

          {/* Mode */}
          <div className="px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${t.border}` }}>
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
                  style={{ background: t.optionBg, color: m === mode ? "#FF5F1F" : t.optionText }}
                >
                  {modeLabel(m)}
                </option>
              ))}
            </select>
          </div>

          {/* Camera */}
          {cameraDevices.length > 1 && (
            <div className="px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${t.border}` }}>
              <p className="font-mono text-xs tracking-[0.2em] uppercase mb-2 liquid-meta">
                Camera
              </p>
              <select
                value={selectedCamera}
                onChange={(e) => selectCamera(e.target.value)}
                className="w-full liquid-glass liquid-float liquid-pill font-mono text-xs tracking-wider py-2 px-2.5 bg-transparent appearance-none cursor-pointer transition-colors duration-100 focus:outline-none liquid-title"
              >
                {cameraDevices.map((d) => (
                  <option
                    key={d.deviceId}
                    value={d.deviceId}
                    style={{ background: t.optionBg, color: d.deviceId === selectedCamera ? "#FF5F1F" : t.optionText }}
                  >
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Actions */}
          <div className="px-5 py-4" style={{ borderBottom: `1px solid ${t.border}` }}>
            <div className="grid grid-cols-2 gap-1.5 mb-1.5">
              <span
                className="liquid-glass liquid-float liquid-pill font-display text-[10px] font-medium tracking-[0.12em] uppercase py-2 text-center"
                style={{ color: audioInputActive ? "#FF5F1F" : t.inactive }}
              >
                MIC {audioInputActive ? "LIVE" : "OFF"}
              </span>
              <button
                onClick={() => onVoiceOutputChange(!voiceOutputEnabled)}
                className="liquid-glass liquid-float liquid-pill font-display text-[10px] font-medium tracking-[0.12em] uppercase py-2 transition-colors duration-100"
                style={{ color: voiceOutputEnabled ? "#FF5F1F" : t.inactive }}
              >
                OUT {voiceOutputEnabled ? "ON" : "OFF"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-1.5">
              <button
                onClick={() => setGlassMode("dark")}
                className="liquid-glass liquid-float liquid-pill font-display text-[10px] font-medium tracking-[0.12em] uppercase py-2 transition-colors duration-100"
                style={{ color: glassMode === "dark" ? "#FF5F1F" : t.inactive }}
              >
                DARK
              </button>
              <button
                onClick={() => setGlassMode("light")}
                className="liquid-glass liquid-float liquid-pill font-display text-[10px] font-medium tracking-[0.12em] uppercase py-2 transition-colors duration-100"
                style={{ color: glassMode === "light" ? "#FF5F1F" : t.inactive }}
              >
                LIGHT
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
              {session.isInspecting ? "\u25A0  STOP" : "INSPECT"}
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
          <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
            {session.hazards.length === 0 ? (
              <div className="px-5 py-4">
                <span className="font-mono text-xs liquid-meta">&mdash;</span>
              </div>
            ) : (
              <>
                <div className="px-5 pt-3 pb-1 flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.16em] uppercase liquid-meta">
                    {session.hazards.length} alert{session.hazards.length !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={() => { session.clearHazards(); setExpandedHazards(new Set()); }}
                    className="font-mono text-[10px] tracking-[0.12em] uppercase transition-colors duration-100"
                    style={{ color: "#ef4444" }}
                  >
                    Clear
                  </button>
                </div>
                {session.hazards.slice(0, 100).map((h) => {
                  const isOpen = expandedHazards.has(h.id);
                  return (
                    <div key={h.id} style={{ borderBottom: `1px solid ${t.border}` }}>
                      <button
                        onClick={() => setExpandedHazards((prev) => {
                          const next = new Set(prev);
                          if (next.has(h.id)) next.delete(h.id); else next.add(h.id);
                          return next;
                        })}
                        className="w-full px-5 py-2.5 flex items-center justify-between gap-2 text-left"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: SEVERITY_COLOR[h.severity] ?? t.inactive }}
                          />
                          <span className="font-sans text-xs font-light leading-tight liquid-title truncate">
                            {h.description}
                          </span>
                        </span>
                        <span
                          className="font-mono text-[10px] shrink-0 transition-transform duration-150"
                          style={{ color: t.chevron, transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                        >
                          &#x25BE;
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-5 pb-3 space-y-1">
                          <span
                            className="font-mono text-[10px] uppercase tracking-widest"
                            style={{ color: SEVERITY_COLOR[h.severity] ?? t.inactive }}
                          >
                            {h.severity} &bull; {Math.round(h.confidence * 100)}%
                          </span>
                          <p className="font-mono text-[10px] liquid-meta">
                            {h.rule_id || "rule:n/a"} &bull; {h.camera_id || "camera:n/a"}
                          </p>
                          <p className="font-mono text-[10px] liquid-meta">
                            {h.persistence_seconds ?? 0}s &bull; {h.risk_trend || "new"}
                          </p>
                          {h.location && (
                            <p className="font-mono text-[10px] liquid-meta">
                              loc: {h.location}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
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
          <div className="px-5 py-3" style={{ borderTop: `1px solid ${t.border}` }}>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {[["I", "inspect"], ["R", "report"], ["O", "overlays"], ["1\u20134", "feed"]].map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <kbd
                    className="font-mono text-xs px-1 py-px"
                    style={{ color: t.inactive, border: `1px solid ${t.kbdBorder}`, background: t.kbdBg }}
                  >
                    {k}
                  </kbd>
                  <span className="font-sans text-xs font-light" style={{ color: t.kbdLabel }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
