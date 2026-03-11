"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { speakResponse } from "@/lib/tts";
import { ArgusIndicator } from "@/components/ArgusIndicator";
import { HazardOverlay, type GlassMode } from "@/components/HazardOverlay";
import type { Hazard, Overlay } from "@/lib/types";

interface ARSessionProps {
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
}

/**
 * AR Glasses mode — near-invisible UI.
 *
 * The wearer should NOT see a dashboard. All interaction is voice-driven
 * (wake word "argus" handled at page level, plus explicit commands here).
 * The only visual element is a tiny ARGUS indicator in the top-left corner
 * that appears when processing or speaking, and vanishes when idle.
 */
export function ARSession({ session, mode }: ARSessionProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlaysVisible, setOverlaysVisible] = useState(false);
  const [glassMode, setGlassMode] = useState<GlassMode>("dark");

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
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {});
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

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

  /* ── Voice commands (always active — no button to toggle) ── */
  const handleVoiceCommand = useCallback(
    (transcript: string) => {
      const t = transcript.toLowerCase();
      if (t.includes("inspect") || t.includes("start")) {
        session.startInspection(mode);
        speakResponse("On it.");
      } else if (t.includes("stop")) {
        session.stopInspection();
        speakResponse("Stopped.");
      } else if (t.includes("report")) {
        session.generateReport();
        speakResponse("Generating report.");
      } else if (t.includes("overlay") || t.includes("show") || t.includes("hide")) {
        setOverlaysVisible((v) => {
          speakResponse(v ? "Overlays hidden." : "Overlays visible.");
          return !v;
        });
      } else if (t.includes("light") || t.includes("bright")) {
        setGlassMode("light");
        speakResponse("Light glass.");
      } else if (t.includes("dark")) {
        setGlassMode("dark");
        speakResponse("Dark glass.");
      } else if (t.includes("status")) {
        const n = session.hazards.length;
        speakResponse(
          `${n} hazard${n !== 1 ? "s" : ""} detected. Risk level ${session.riskLevel}.`
        );
      }
    },
    [session, mode]
  );

  useVoiceCommands({ onCommand: handleVoiceCommand, enabled: true });

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

      <HazardOverlay overlays={session.overlays} visible={overlaysVisible} glassMode={glassMode} />

      {/* Tiny indicator + context label — both invisible when truly idle */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
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
    </div>
  );
}
