"use client";

import { CameraView } from "@/components/CameraView";
import type { GlassMode } from "@/components/HazardOverlay";
import type { Overlay } from "@/lib/types";

interface FeedGridProps {
  overlays: Overlay[];
  overlaysVisible?: boolean;
  glassMode?: GlassMode;
  videoSource?: string | null;
  onFrame: (blob: Blob) => void;
  activeFeed: number;
  onSelectFeed: (index: number) => void;
}

const FEED_LABELS = [
  "CAM-01  MAIN ENTRY",
  "CAM-02  FLOOR A",
  "CAM-03  LOADING DOCK",
  "CAM-04  ROOF ACCESS",
];

export function FeedGrid({
  overlays,
  overlaysVisible = true,
  glassMode = "dark",
  videoSource,
  onFrame,
  activeFeed,
  onSelectFeed,
}: FeedGridProps) {
  return (
    <div className="grid grid-cols-2 gap-px h-full" style={{ background: "#1c1c1c" }}>
      {FEED_LABELS.map((label, i) => (
        <button
          key={i}
          onClick={() => onSelectFeed(i)}
          className="relative overflow-hidden bg-black focus:outline-none"
        >
          {/* Active: top orange line */}
          {activeFeed === i && (
            <div className="absolute top-0 left-0 right-0 h-px z-10" style={{ background: "#FF5F1F" }} />
          )}

          {i === 0 ? (
            <CameraView
              overlays={overlays}
              overlaysVisible={overlaysVisible}
              glassMode={glassMode}
              videoSource={videoSource}
              onFrame={onFrame}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: "#080808" }}>
              <span className="font-mono text-xs" style={{ color: "#1c1c1c" }}>—</span>
            </div>
          )}

          {/* Feed label */}
          <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black to-transparent">
            <span
              className="font-mono text-xs tracking-[0.15em]"
              style={{ color: activeFeed === i ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)" }}
            >
              {label}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
