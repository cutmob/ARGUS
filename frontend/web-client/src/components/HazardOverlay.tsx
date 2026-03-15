"use client";

import type { Overlay } from "@/lib/types";

export type GlassMode = "dark" | "light";

interface HazardOverlayProps {
  overlays: Overlay[];
  visible: boolean;
  glassMode?: GlassMode;
  fading?: boolean;
}

const SEVERITY_COLOR: Record<string, string> = {
  low:      "#22c55e",
  medium:   "#f59e0b",
  high:     "#ef4444",
  critical: "#dc2626",
};

// Dark mode: tinted semi-transparent fill
const DARK_BG: Record<string, string> = {
  low:      "rgba(34,197,94,0.10)",
  medium:   "rgba(245,158,11,0.10)",
  high:     "rgba(239,68,68,0.12)",
  critical: "rgba(220,38,38,0.14)",
};

// Light mode: white frosted fill, severity bleeds through very subtly
const LIGHT_BG: Record<string, string> = {
  low:      "rgba(255,255,255,0.18)",
  medium:   "rgba(255,255,255,0.18)",
  high:     "rgba(255,255,255,0.18)",
  critical: "rgba(255,255,255,0.18)",
};

export function HazardOverlay({ overlays, visible, glassMode = "dark", fading = false }: HazardOverlayProps) {
  if (!visible || overlays.length === 0) return null;

  const isDark = glassMode === "dark";
  const animClass = fading ? "overlay-exit" : "overlay-enter";

  return (
    <div className={`absolute inset-0 pointer-events-none z-10 ${animClass}`}>
      {overlays.map((overlay, i) => {
        if (!overlay.bbox) return null;
        const { x, y, width, height } = overlay.bbox;
        const color = SEVERITY_COLOR[overlay.severity] ?? "#FF5F1F";
        const bg    = isDark
          ? (DARK_BG[overlay.severity]  ?? "rgba(255,95,31,0.10)")
          : (LIGHT_BG[overlay.severity] ?? "rgba(255,255,255,0.18)");

        return (
          <div
            key={i}
            className="absolute"
            style={{
              left:   `${x * 100}%`,
              top:    `${y * 100}%`,
              width:  `${width * 100}%`,
              height: `${height * 100}%`,
            }}
          >
            {/* Glass fill */}
            <div
              className="absolute inset-0"
              style={{
                background:              bg,
                backdropFilter:          isDark ? "blur(2px)" : "blur(6px) saturate(1.4)",
                WebkitBackdropFilter:    isDark ? "blur(2px)" : "blur(6px) saturate(1.4)",
                borderWidth:             1,
                borderStyle:             "solid",
                borderColor:             isDark ? `${color}33` : "rgba(255,255,255,0.5)",
                // Light mode: faint specular highlight on top edge
                borderTopColor:          isDark ? `${color}33` : "rgba(255,255,255,0.8)",
                borderRadius:            3,
                // Light mode: soft shadow so it lifts off the scene
                boxShadow:               isDark
                  ? undefined
                  : "0 2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.6)",
              }}
            />

            {/* Corner brackets */}
            <Corner pos="tl" color={isDark ? color : "rgba(0,0,0,0.35)"} />
            <Corner pos="tr" color={isDark ? color : "rgba(0,0,0,0.35)"} />
            <Corner pos="bl" color={isDark ? color : "rgba(0,0,0,0.35)"} />
            <Corner pos="br" color={isDark ? color : "rgba(0,0,0,0.35)"} />

            {/* Label pill — above the box */}
            <div
              className="absolute flex items-center gap-1.5"
              style={{
                bottom:               "calc(100% + 4px)",
                left:                 0,
                padding:              "2px 6px",
                background:           isDark
                  ? "rgba(0,0,0,0.75)"
                  : "rgba(255,255,255,0.82)",
                backdropFilter:       "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                borderRadius:         3,
                border:               isDark
                  ? `1px solid ${color}44`
                  : "1px solid rgba(255,255,255,0.7)",
                boxShadow:            isDark
                  ? undefined
                  : "0 1px 6px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.9)",
              }}
            >
              {/* Severity dot */}
              <div
                className="shrink-0"
                style={{
                  width:      5,
                  height:     5,
                  borderRadius: "50%",
                  background: color,
                  boxShadow:  `0 0 4px ${color}88`,
                }}
              />
              <span
                className="font-mono text-[9px] font-bold tracking-[0.12em] uppercase whitespace-nowrap"
                style={{ color: isDark ? color : color }}
              >
                {overlay.severity}
              </span>
              {overlay.label && (
                <span
                  className="font-mono text-[9px] tracking-wide whitespace-nowrap"
                  style={{ color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)" }}
                >
                  {overlay.label}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Corner({ pos, color }: { pos: "tl" | "tr" | "bl" | "br"; color: string }) {
  const size = 10;
  const style: React.CSSProperties = {
    position: "absolute",
    width:    size,
    height:   size,
    pointerEvents: "none",
  };

  if (pos === "tl") {
    style.top    = -1; style.left  = -1;
    style.borderTop  = `1.5px solid ${color}`;
    style.borderLeft = `1.5px solid ${color}`;
  } else if (pos === "tr") {
    style.top    = -1; style.right = -1;
    style.borderTop   = `1.5px solid ${color}`;
    style.borderRight = `1.5px solid ${color}`;
  } else if (pos === "bl") {
    style.bottom = -1; style.left  = -1;
    style.borderBottom = `1.5px solid ${color}`;
    style.borderLeft   = `1.5px solid ${color}`;
  } else {
    style.bottom = -1; style.right = -1;
    style.borderBottom = `1.5px solid ${color}`;
    style.borderRight  = `1.5px solid ${color}`;
  }

  return <div style={style} />;
}
