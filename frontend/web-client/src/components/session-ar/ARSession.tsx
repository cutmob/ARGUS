"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { EventPillOverlay } from "@/components/EventPillOverlay";
import { ArgusIndicator } from "@/components/ArgusIndicator";
import { HazardOverlay, type GlassMode } from "@/components/HazardOverlay";
import type { ActionCard, Hazard, Overlay } from "@/lib/types";

interface ARSessionProps {
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
  videoSource?: string | null;
  /** Whether the live audio input is currently active (always-on when inspecting). */
  audioInputActive: boolean;
  overlaysFading?: boolean;
  glassMode?: GlassMode;
  onGlassModeChange?: (mode: GlassMode) => void;
  onOpenReportView?: () => void;
  onCloseReportView?: () => void;
}

/**
 * AR Glasses mode — near-invisible UI.
 *
 * The wearer should NOT see a dashboard. All interaction is voice-driven
 * (wake word "argus" handled at page level, plus explicit commands here).
 * The only visual element is a tiny ARGUS indicator in the top-left corner
 * that appears when processing or speaking, and vanishes when idle.
 */
export function ARSession({
  session,
  mode,
  onModeChange,
  videoSource,
  audioInputActive,
  overlaysFading = false,
  glassMode: externalGlassMode,
  onGlassModeChange,
  onOpenReportView,
  onCloseReportView,
}: ARSessionProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlaysVisible, setOverlaysVisible] = useState(Boolean(videoSource));
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

  // Context-aware micro-label shown beside the indicator
  const indicatorLabel = session.speaking
    ? null                                          // voice is the message
    : session.processing && session.isInspecting
    ? "scanning"
    : session.processing
    ? "thinking"
    : session.isInspecting && session.hazards.length > 0
    ? `${session.hazards.length} flagged`
    : session.isInspecting
    ? "watching"
    : null;                                         // idle + not inspecting → invisible

  /* ── Camera stream ── */
  useEffect(() => {
    let stream: MediaStream;
    if (videoSource) {
      const vid = videoRef.current;
      if (vid) {
        vid.srcObject = null;
        vid.src = videoSource;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        const tryPlay = () => {
          vid.removeEventListener("canplay", tryPlay);
          vid.removeEventListener("loadeddata", tryPlay);
          void vid.play().catch((err) => console.warn("[ARGUS] Video play failed:", err));
        };
        vid.addEventListener("canplay", tryPlay);
        vid.addEventListener("loadeddata", tryPlay);
        vid.load();
      }
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {});
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      const vid = videoRef.current;
      if (vid) {
        vid.pause();
        vid.removeAttribute("src");
        vid.srcObject = null;
        vid.load();
      }
    };
  }, [videoSource]);

  useEffect(() => {
    if (videoSource) {
      setOverlaysVisible(true);
    }
  }, [videoSource]);

  /* ── Frame capture — 1fps while inspecting, object-cover aligned ── */
  useEffect(() => {
    if (!session.isInspecting) return;
    const id = setInterval(() => {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!canvas || !video || video.readyState < 2) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const el   = video.getBoundingClientRect();
      const elW  = el.width;
      const elH  = el.height;
      const vW   = video.videoWidth;
      const vH   = video.videoHeight;
      if (!vW || !vH || !elW || !elH) return;
      const scale = Math.max(elW / vW, elH / vH);
      const srcW  = elW / scale;
      const srcH  = elH / scale;
      const srcX  = (vW - srcW) / 2;
      const srcY  = (vH - srcH) / 2;
      canvas.width  = Math.round(srcW);
      canvas.height = Math.round(srcH);
      ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob && session.sendFrame(blob), "image/jpeg", 0.7);
    }, 1000);
    return () => clearInterval(id);
  }, [session.isInspecting, session.sendFrame]);

  return (
    <div className="h-screen w-screen bg-black relative overflow-hidden">
      {/* Fullscreen passthrough — the glasses camera feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      <HazardOverlay overlays={session.overlays} visible={overlaysVisible} glassMode={glassMode} fading={overlaysFading} />
      <EventPillOverlay
        hazards={session.hazards}
        overlays={session.overlays}
        visible={overlaysVisible}
        glassMode={glassMode}
        interactive={false}
        expandMode="none"
        placementMode="stack-top-left"
        maxItems={3}
      />

      {session.actionCards.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 z-20 space-y-1.5">
          {session.actionCards.slice(0, 3).map((card, idx) => (
            <div
              key={`${card.hazard_ref_id ?? card.title}-${idx}`}
              className="liquid-glass liquid-float liquid-pill liquid-enter px-3 py-1.5"
            >
              <p className="font-mono text-[9px] tracking-[0.16em] uppercase liquid-meta">
                {card.priority} action
              </p>
              <p className="font-sans text-xs mt-0.5 liquid-title">{card.title}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tiny indicator + context label — both invisible when truly idle */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArgusIndicator state={indicatorState} />
          {indicatorLabel && (
            <span
              className="font-mono text-[9px] tracking-[0.2em] uppercase"
              style={{ color: "rgba(255,255,255,0.25)" }}
            >
              {indicatorLabel}
            </span>
          )}
        </div>
        {audioInputActive && (
          <span
            className="liquid-glass liquid-float liquid-pill liquid-enter px-2 py-1 font-mono text-[9px] tracking-[0.2em] uppercase"
            style={{ color: "#FF5F1F" }}
          >
            Live
          </span>
        )}
      </div>
    </div>
  );
}
