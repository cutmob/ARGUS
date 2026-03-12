"use client";

import { useState } from "react";
import { CameraView } from "@/components/CameraView";
import { ArgusIndicator } from "@/components/ArgusIndicator";
import { INSPECTION_MODES, modeLabel } from "@/lib/modes";
import type { GlassMode } from "@/components/HazardOverlay";
import type { ActionCard, Hazard, Overlay } from "@/lib/types";

interface SmartphoneSessionProps {
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
  };
  mode: string;
  onModeChange: (mode: string) => void;
  overlaysVisible?: boolean;
  videoSource?: string | null;
  glassMode?: GlassMode;
  onGlassModeChange?: (mode: GlassMode) => void;
}

const RISK_COLOR: Record<string, string> = {
  low:      "#22c55e",
  medium:   "#f59e0b",
  high:     "#ef4444",
  critical: "#ef4444",
};

export function SmartphoneSession({
  session,
  mode,
  onModeChange,
  overlaysVisible = true,
  videoSource,
  glassMode: externalGlassMode,
  onGlassModeChange,
}: SmartphoneSessionProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [localGlassMode, setLocalGlassMode] = useState<GlassMode>("dark");
  const glassMode = externalGlassMode ?? localGlassMode;
  const setGlassMode = (next: GlassMode) => {
    if (onGlassModeChange) onGlassModeChange(next);
    else setLocalGlassMode(next);
  };
  const indicatorState = session.speaking ? "speaking" : session.processing ? "processing" : "idle";
  const riskColor = RISK_COLOR[session.riskLevel] ?? "#4a4a4a";

  return (
    <div className="h-screen w-screen bg-black relative overflow-hidden">
      {/* Camera */}
      <div className="absolute inset-0">
        <CameraView
          overlays={session.overlays}
          overlaysVisible={overlaysVisible}
          glassMode={glassMode}
          videoSource={videoSource}
          onFrame={session.sendFrame}
        />
      </div>

      {/* Top status */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 pt-6 pb-12 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-bold tracking-[0.25em] uppercase" style={{ color: "rgba(255,255,255,0.7)" }}>
            ARGUS
          </span>
          <ArgusIndicator state={indicatorState} />
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xs tracking-widest uppercase" style={{ color: riskColor }}>
            {session.riskLevel}
          </span>
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: session.connected ? "#FF5F1F" : "#1c1c1c" }}
          />
        </div>
      </div>

      {/* Bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-20">
        <button
          onClick={() => setSheetOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-5 bg-gradient-to-t from-black/85 to-transparent"
        >
          <span className="font-mono text-xs tracking-widest" style={{ color: "rgba(255,255,255,0.2)" }}>
            {session.hazards.length > 0
              ? `${session.hazards.length} HAZARD${session.hazards.length !== 1 ? "S" : ""}`
              : "—"}
          </span>
          <div className="w-4 h-px" style={{ background: "rgba(255,255,255,0.12)" }} />
        </button>

        {sheetOpen && (
          <div className="liquid-glass liquid-float" style={{ borderTop: "1px solid #1c1c1c" }}>
            {/* Mode */}
            <div
              className="flex gap-6 px-5 py-3 overflow-x-auto"
              style={{ borderBottom: "1px solid #1c1c1c" }}
            >
              {INSPECTION_MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  className="font-mono text-xs tracking-wider uppercase whitespace-nowrap transition-colors duration-100"
                  style={
                    mode === m
                      ? { color: "#FF5F1F", borderBottom: "1px solid #FF5F1F", paddingBottom: 2 }
                      : { color: "#4a4a4a" }
                  }
                >
                  {modeLabel(m)}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2 px-5 py-4" style={{ borderBottom: "1px solid #1c1c1c" }}>
              <button
                onClick={() =>
                  session.isInspecting ? session.stopInspection() : session.startInspection(mode)
                }
                className="flex-1 liquid-glass liquid-float liquid-pill font-display text-xs font-bold tracking-[0.2em] uppercase py-3.5 transition-colors duration-100"
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
                className="liquid-glass liquid-float liquid-pill font-display text-xs font-medium px-5 tracking-[0.15em] uppercase transition-colors duration-100 liquid-meta"
              >
                REPORT
              </button>
              <button
                onClick={session.requestActions}
                className="liquid-glass liquid-float liquid-pill font-display text-xs font-medium px-3 tracking-[0.12em] uppercase transition-colors duration-100 liquid-meta"
              >
                TOP 3
              </button>
              <button
                onClick={() => setGlassMode(glassMode === "dark" ? "light" : "dark")}
                className="liquid-glass liquid-float liquid-pill font-display text-xs font-medium px-4 tracking-[0.15em] uppercase transition-colors duration-100 liquid-title"
                title="Toggle overlay style"
              >
                {glassMode === "dark" ? "◑" : "○"}
              </button>
            </div>

            {/* Hazards */}
            <div className="max-h-48 overflow-y-auto">
              {session.hazards.length === 0 ? (
                <p className="font-mono text-xs text-center py-6" style={{ color: "#1c1c1c" }}>—</p>
              ) : (
                session.hazards.slice(0, 12).map((h) => (
                  <div key={h.id} className="px-5 py-3" style={{ borderBottom: "1px solid #0f0f0f" }}>
                    <p className="font-sans text-xs font-light leading-relaxed liquid-title">
                      {h.description}
                    </p>
                    <span className="font-mono text-xs tracking-widest uppercase" style={{ color: "#4a4a4a" }}>
                      {h.severity} • {Math.round(h.confidence * 100)}%
                    </span>
                    <p className="font-mono text-[10px] mt-1 liquid-meta">
                      {h.rule_id || "rule:n/a"} • {h.camera_id || "camera:n/a"} • {h.persistence_seconds ?? 0}s • {h.risk_trend || "new"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
