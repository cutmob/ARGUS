"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { CameraView } from "@/components/CameraView";
import type { GlassMode } from "@/components/HazardOverlay";
import type { Hazard, Overlay } from "@/lib/types";

interface FeedGridProps {
  hazards: Hazard[];
  overlays: Overlay[];
  overlaysVisible?: boolean;
  overlaysFading?: boolean;
  glassMode?: GlassMode;
  videoSource?: string | null;
  videoFile?: File | null;
  deviceId?: string;
  onFrame: (blob: Blob) => void;
  activeFeed: number;
  onSelectFeed: (index: number) => void;
}

const DEFAULT_LABELS = [
  "CAM-01  MAIN ENTRY",
  "CAM-02  FLOOR A",
  "CAM-03  LOADING DOCK",
  "CAM-04  ROOF ACCESS",
];

const LS_KEY = "argus_feed_labels";

function loadLabels(): string[] {
  if (typeof window === "undefined") return DEFAULT_LABELS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 4) return parsed;
    }
  } catch {}
  return [...DEFAULT_LABELS];
}

function saveLabels(labels: string[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(labels));
}

function FeedLabel({
  label,
  active,
  onRename,
}: {
  label: string;
  active: boolean;
  onRename: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== label) onRename(trimmed);
    else setDraft(label);
    setEditing(false);
  }, [draft, label, onRename]);

  if (editing) {
    return (
      <div
        className="absolute bottom-0 left-0 right-0 px-3 py-1.5 bg-gradient-to-t from-black to-transparent flex items-center gap-1.5 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(label); setEditing(false); }
          }}
          onBlur={commit}
          className="flex-1 bg-transparent border-b font-mono text-xs tracking-[0.15em] outline-none px-0 py-0.5"
          style={{
            color: "rgba(255,255,255,0.7)",
            borderColor: "#FF5F1F",
            caretColor: "#FF5F1F",
          }}
          maxLength={30}
        />
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); commit(); }}
          className="shrink-0 flex items-center justify-center rounded"
          style={{ width: 18, height: 18, color: "#FF5F1F" }}
          title="Save"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,6 5,9 10,3" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black to-transparent"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(label);
        setEditing(true);
      }}
    >
      <span
        className="font-mono text-xs tracking-[0.15em] select-none"
        style={{ color: active ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)" }}
        title="Double-click to rename"
      >
        {label}
      </span>
    </div>
  );
}

export function FeedGrid({
  hazards,
  overlays,
  overlaysVisible = true,
  overlaysFading = false,
  glassMode = "dark",
  videoSource,
  videoFile,
  deviceId,
  onFrame,
  activeFeed,
  onSelectFeed,
}: FeedGridProps) {
  const [labels, setLabels] = useState(loadLabels);

  const handleRename = useCallback((index: number, next: string) => {
    setLabels((prev) => {
      const updated = [...prev];
      updated[index] = next;
      saveLabels(updated);
      return updated;
    });
  }, []);

  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-px h-full" style={{ background: "#1c1c1c" }}>
      {labels.map((label, i) => (
        <div
          key={i}
          onClick={() => onSelectFeed(i)}
          className="relative overflow-hidden bg-black cursor-pointer"
          role="button"
          tabIndex={0}
        >
          {/* Active: top orange line */}
          {activeFeed === i && (
            <div className="absolute top-0 left-0 right-0 h-px z-10" style={{ background: "#FF5F1F" }} />
          )}

          {i === 0 ? (
            <CameraView
              hazards={hazards}
              overlays={overlays}
              overlaysVisible={overlaysVisible}
              overlaysFading={overlaysFading}
              glassMode={glassMode}
              videoSource={videoSource}
              videoFile={videoFile}
              deviceId={deviceId}
              onFrame={onFrame}
              pillExpandMode="click"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: "#080808" }}>
              <span className="font-mono text-xs" style={{ color: "#1c1c1c" }}>—</span>
            </div>
          )}

          <FeedLabel
            label={label}
            active={activeFeed === i}
            onRename={(next) => handleRename(i, next)}
          />
        </div>
      ))}
    </div>
  );
}
