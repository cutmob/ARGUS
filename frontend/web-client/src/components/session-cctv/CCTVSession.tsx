"use client";

import { useState, useEffect } from "react";
import { FeedGrid } from "./FeedGrid";
import { ArgusIndicator } from "@/components/ArgusIndicator";
import { INSPECTION_MODES, modeLabel } from "@/lib/modes";
import type { Hazard, Overlay } from "@/lib/types";

interface CCTVSessionProps {
  session: {
    connected: boolean;
    isInspecting: boolean;
    hazards: Hazard[];
    overlays: Overlay[];
    riskLevel: string;
    processing: boolean;
    speaking: boolean;
    sendFrame: (blob: Blob) => void;
    startInspection: (mode: string) => void;
    stopInspection: () => void;
    generateReport: () => void;
  };
  mode: string;
  onModeChange: (mode: string) => void;
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

export function CCTVSession({ session, mode, onModeChange }: CCTVSessionProps) {
  const [activeFeed, setActiveFeed] = useState(0);
  const [time, setTime]             = useState("");

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

  const riskColor = RISK_COLOR[session.riskLevel] ?? "#4a4a4a";
  const hazardStr = session.hazards.length.toString().padStart(2, "0");

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: "#000" }}>
      {/* Top bar — single line */}
      <header
        className="h-9 flex items-center justify-between px-5 shrink-0"
        style={{ borderBottom: "1px solid #1c1c1c" }}
      >
        <div className="flex items-center gap-3">
          <span className="font-display text-xs font-bold tracking-[0.25em] uppercase text-white">
            ARGUS
          </span>
          <span style={{ color: "#1c1c1c", fontSize: 10 }}>|</span>
          <span className="font-mono text-xs tracking-[0.15em] uppercase" style={{ color: "#4a4a4a" }}>
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
          <span className="font-mono text-xs" style={{ color: "#4a4a4a" }}>{time}</span>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Feed grid */}
        <div className="flex-1 overflow-hidden">
          <FeedGrid
            overlays={session.overlays}
            onFrame={session.sendFrame}
            activeFeed={activeFeed}
            onSelectFeed={setActiveFeed}
          />
        </div>

        {/* Sidebar */}
        <aside
          className="w-52 flex flex-col overflow-hidden shrink-0"
          style={{ background: "#080808", borderLeft: "1px solid #1c1c1c" }}
        >
          {/* Risk */}
          <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid #1c1c1c" }}>
            <p className="font-mono text-xs tracking-[0.2em] uppercase mb-2" style={{ color: "#4a4a4a" }}>
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
            <p className="font-mono text-xs tracking-[0.2em] uppercase mb-1" style={{ color: "#4a4a4a" }}>
              Hazards
            </p>
            <p className="font-mono font-normal leading-none text-white" style={{ fontSize: 36 }}>
              {hazardStr}
            </p>
          </div>

          {/* Mode */}
          <div className="px-5 pt-4 pb-3" style={{ borderBottom: "1px solid #1c1c1c" }}>
            <p className="font-mono text-xs tracking-[0.2em] uppercase mb-2" style={{ color: "#4a4a4a" }}>
              Mode
            </p>
            <select
              value={mode}
              onChange={(e) => onModeChange(e.target.value)}
              className="w-full font-mono text-xs tracking-wider uppercase py-2 px-2.5 bg-transparent appearance-none cursor-pointer transition-colors duration-100 focus:outline-none"
              style={{
                color: "#f0f0f0",
                border: "1px solid #1c1c1c",
                borderRadius: 0,
              }}
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
            <button
              onClick={() =>
                session.isInspecting ? session.stopInspection() : session.startInspection(mode)
              }
              className="w-full font-display text-xs font-bold tracking-[0.2em] uppercase py-3 transition-colors duration-100"
              style={
                session.isInspecting
                  ? { border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444" }
                  : { background: "#FF5F1F", color: "#000" }
              }
            >
              {session.isInspecting ? "■  STOP" : "INSPECT"}
            </button>
            <button
              onClick={session.generateReport}
              className="w-full font-display text-xs font-medium tracking-[0.15em] uppercase py-2 mt-1.5 transition-colors duration-100"
              style={{ border: "1px solid #1c1c1c", color: "#4a4a4a" }}
            >
              REPORT
            </button>
          </div>

          {/* Hazard log */}
          <div className="flex-1 overflow-y-auto">
            {session.hazards.length === 0 ? (
              <div className="px-5 py-4">
                <span className="font-mono text-xs" style={{ color: "#1c1c1c" }}>—</span>
              </div>
            ) : (
              session.hazards.map((h) => (
                <div key={h.id} className="px-5 py-3" style={{ borderBottom: "1px solid #1c1c1c" }}>
                  <p className="font-sans text-xs font-light leading-relaxed" style={{ color: "#7a7a7a" }}>
                    {h.description}
                  </p>
                  <span
                    className="font-mono text-xs uppercase tracking-widest"
                    style={{ color: SEVERITY_COLOR[h.severity] ?? "#4a4a4a" }}
                  >
                    {h.severity}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Keyboard shortcuts */}
          <div className="px-5 py-3" style={{ borderTop: "1px solid #1c1c1c" }}>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {[["I", "inspect"], ["R", "report"], ["1–4", "feed"]].map(([k, v]) => (
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
