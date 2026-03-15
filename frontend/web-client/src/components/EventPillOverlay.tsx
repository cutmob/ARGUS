"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { GlassMode } from "@/components/HazardOverlay";
import type { Hazard, Overlay, Severity } from "@/lib/types";

interface EventPillOverlayProps {
  hazards: Hazard[];
  overlays: Overlay[];
  visible: boolean;
  glassMode?: GlassMode;
  interactive?: boolean;
  expandMode?: "click" | "tap" | "none";
  placementMode?: "follow" | "stack-top-left";
  maxItems?: number;
  fading?: boolean;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
  critical: "#dc2626",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  critical: "CRIT",
};

// How long each pill stays visible before it starts fading out (ms), by severity
const PILL_DISPLAY_MS: Record<Severity, number> = {
  low:      3_500,
  medium:   4_500,
  high:     6_500,
  critical: 9_000,
};
const PILL_FADE_MS = 400;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

function buildPillPosition(
  hazard: Hazard,
  overlay: Overlay | undefined,
  index: number,
  mode: "follow" | "stack-top-left",
) {
  if (mode === "stack-top-left") {
    return { left: "16px", top: `${52 + index * 78}px` };
  }
  const bbox = overlay?.bbox ?? hazard.bbox;
  if (bbox) {
    return {
      left: `${clamp((bbox.x + bbox.width + 0.012) * 100, 6, 82)}%`,
      top:  `${clamp((bbox.y + Math.min(bbox.height * 0.18, 0.08)) * 100, 6, 86)}%`,
    };
  }
  return { right: "16px", top: `${16 + index * 70}px` };
}

function formatAge(seconds: number): string {
  if (seconds < 1)  return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  return `${m}m ago`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

// ─── Single pill card — owns its own lifecycle timer ─────────────────────────

interface PillCardProps {
  hazard: Hazard;
  overlay: Overlay | undefined;
  index: number;
  glassMode: GlassMode;
  expandMode: "click" | "tap" | "none";
  placementMode: "follow" | "stack-top-left";
}

function PillCard({ hazard, overlay, index, glassMode, expandMode, placementMode }: PillCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [fading,   setFading]   = useState(false);
  const [gone,     setGone]     = useState(false);

  // Auto-dismiss lifecycle
  useEffect(() => {
    const displayMs = PILL_DISPLAY_MS[hazard.severity] ?? 24_000;
    const fadeTimer = setTimeout(() => {
      setFading(true);
      setTimeout(() => setGone(true), PILL_FADE_MS);
    }, displayMs);
    return () => clearTimeout(fadeTimer);
  }, [hazard.id, hazard.severity]);

  if (gone) return null;

  const color    = SEVERITY_COLOR[hazard.severity] ?? "#FF5F1F";
  const sevLabel = SEVERITY_LABEL[hazard.severity] ?? hazard.severity.toUpperCase();
  const conf     = Math.round(hazard.confidence * 100);
  const dark     = glassMode === "dark";
  const position = buildPillPosition(hazard, overlay, index, placementMode);

  const persistSec   = hazard.persistence_seconds ?? 0;
  const trend        = hazard.risk_trend || "new";
  const occurrences  = hazard.occurrences ?? 1;
  const hasHistory   = occurrences > 1 || (!!hazard.first_seen_at && !!hazard.last_seen_at);
  const cameraLabel  = hazard.camera_id?.replace(/^cam_/, "") ?? null;

  const trendColor =
    trend === "escalating" ? "#ef4444"
    : trend === "stable"   ? "#f59e0b"
    : trend === "declining" ? "#22c55e"
    : dark ? "rgba(245,245,245,0.55)" : "rgba(20,20,20,0.55)";

  function handleClick() {
    if (expandMode === "none") return;
    setExpanded((x) => !x);
  }

  const baseOpacity = fading ? 0 : 1;

  return (
    <div
      className="absolute"
      style={{
        ...position,
        maxWidth: expanded
          ? "min(24rem, calc(100vw - 2rem))"
          : "min(19rem, calc(100vw - 2rem))",
        transition: `max-width 200ms ease, opacity ${PILL_FADE_MS}ms ease`,
        opacity: baseOpacity,
        zIndex: 20,
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        className="pointer-events-auto text-left w-full"
        style={{
          background: dark ? "rgba(12,12,12,0.58)" : "rgba(255,255,255,0.36)",
          border: dark
            ? `1px solid rgba(255,255,255,0.09)`
            : `1px solid rgba(255,255,255,0.38)`,
          backdropFilter:       dark ? "blur(20px) saturate(1.1)" : "blur(22px) saturate(1.18)",
          WebkitBackdropFilter: dark ? "blur(20px) saturate(1.1)" : "blur(22px) saturate(1.18)",
          boxShadow: dark
            ? `0 10px 28px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px ${color}14`
            : `0 8px 20px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.54)`,
          borderRadius: expanded ? 16 : 18,
          padding: "12px 16px",
          minWidth: 210,
          transition: "border-radius 200ms ease, box-shadow 200ms ease",
        }}
      >
        {/* ── Header: severity badge · description · confidence ── */}
        <div className="flex items-start gap-2.5">
          {/* Severity badge */}
          <span
            className="shrink-0 inline-flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-full mt-px"
            style={{
              background: `${color}1a`,
              color: dark ? `${color}e0` : `${color}cc`,
              border: `1px solid ${color}28`,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: color, boxShadow: `0 0 5px ${color}66` }}
            />
            {sevLabel}
          </span>

          {/* Description + confidence */}
          <div className="flex-1 min-w-0">
            <p
              className="font-sans leading-snug"
              style={{
                fontSize: 12,
                color: dark ? "rgba(245,245,245,0.88)" : "rgba(15,15,15,0.88)",
                display: "-webkit-box",
                WebkitLineClamp: expanded ? "unset" : 2,
                WebkitBoxOrient: "vertical",
                overflow: expanded ? "visible" : "hidden",
              }}
            >
              {hazard.description}
            </p>

            <div className="flex items-center gap-2 mt-1.5">
              <span
                className="font-mono text-[9px] uppercase tracking-[0.12em]"
                style={{ color: dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.32)" }}
              >
                {conf}% conf
              </span>
              {persistSec > 0 && (
                <>
                  <span style={{ color: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.18)" }}>·</span>
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.1em]"
                    style={{ color: dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.32)" }}
                  >
                    {formatAge(persistSec)}
                  </span>
                </>
              )}
              {expandMode !== "none" && (
                <>
                  <span style={{ color: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.18)" }}>·</span>
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.1em] ml-auto"
                    style={{ color: dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.25)" }}
                  >
                    {expanded ? "less ↑" : "more ↓"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Expanded detail section ── */}
        {expanded && (
          <div
            className="mt-3 pt-3 space-y-3"
            style={{
              borderTop: dark
                ? "1px solid rgba(255,255,255,0.08)"
                : "1px solid rgba(0,0,0,0.08)",
            }}
          >
            {/* Detail grid */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
              {cameraLabel && (
                <DetailCell dark={dark} label="Camera" value={cameraLabel} />
              )}
              {hazard.rule_id && (
                <DetailCell dark={dark} label="Rule" value={hazard.rule_id} />
              )}
              <DetailCell dark={dark} label="Trend" value={trend} valueColor={trendColor} />
              {hazard.location && (
                <DetailCell dark={dark} label="Location" value={hazard.location} />
              )}
            </div>

            {/* Location prose (if long) */}
            {hazard.location && hazard.location.length > 20 && (
              <p
                className="font-sans text-[10px] leading-relaxed"
                style={{ color: dark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.4)" }}
              >
                {hazard.location}
              </p>
            )}

            {/* History node — shown when occurrences > 1 or first/last seen differ */}
            {hasHistory && (
              <div
                className="rounded-xl px-3 py-2.5 space-y-1.5"
                style={{
                  background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                  border: dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.07)",
                }}
              >
                <p
                  className="font-mono text-[8px] uppercase tracking-[0.18em]"
                  style={{ color: dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.3)" }}
                >
                  Observation history
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {occurrences > 1 && (
                    <DetailCell dark={dark} label="Occurrences" value={String(occurrences)} />
                  )}
                  {hazard.first_seen_at && (
                    <DetailCell dark={dark} label="First seen" value={fmtTime(hazard.first_seen_at)} />
                  )}
                  {hazard.last_seen_at && (
                    <DetailCell dark={dark} label="Last seen" value={fmtTime(hazard.last_seen_at)} />
                  )}
                  {hazard.frame_id && (
                    <DetailCell dark={dark} label="Frame" value={hazard.frame_id.slice(0, 8)} />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </button>
    </div>
  );
}

// Tiny reusable label/value cell
function DetailCell({
  dark,
  label,
  value,
  valueColor,
}: {
  dark: boolean;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div>
      <span
        className="font-mono text-[8px] uppercase tracking-[0.18em] block mb-0.5"
        style={{ color: dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.3)" }}
      >
        {label}
      </span>
      <span
        className="font-mono text-[10px] capitalize"
        style={{ color: valueColor ?? (dark ? "rgba(245,245,245,0.72)" : "rgba(15,15,15,0.72)") }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Overlay container ────────────────────────────────────────────────────────

export function EventPillOverlay({
  hazards,
  overlays,
  visible,
  glassMode = "dark",
  interactive = true,
  expandMode = "click",
  placementMode = "follow",
  maxItems = 3,
}: EventPillOverlayProps) {
  const items = useMemo(() => {
    return hazards.slice(0, maxItems).map((hazard, index) => {
      const overlay = overlays.find(
        (o) => o.label === hazard.description || o.bbox === hazard.bbox,
      );
      return { hazard, index, overlay };
    });
  }, [hazards, overlays, maxItems]);

  if (!visible || items.length === 0) return null;

  // Respect interactive flag — if not interactive, force expandMode to "none"
  const effectiveExpandMode = interactive ? expandMode : "none";

  return (
    <div className="absolute inset-0 pointer-events-none">
      {items.map(({ hazard, overlay, index }) => (
        <PillCard
          key={hazard.id}
          hazard={hazard}
          overlay={overlay}
          index={index}
          glassMode={glassMode}
          expandMode={effectiveExpandMode}
          placementMode={placementMode}
        />
      ))}
    </div>
  );
}
