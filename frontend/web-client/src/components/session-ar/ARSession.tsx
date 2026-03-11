"use client";

import { useRef, useCallback, useEffect } from "react";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { speakResponse } from "@/lib/tts";
import { ArgusIndicator } from "@/components/ArgusIndicator";
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

  const indicatorState = session.speaking
    ? "speaking"
    : session.processing
    ? "processing"
    : "idle";

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

  /* ── Frame capture — 500 ms interval while inspecting ── */
  useEffect(() => {
    if (!session.isInspecting) return;
    const id = setInterval(() => {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!canvas || !video || video.readyState < 2) return;
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      canvas.toBlob((blob) => blob && session.sendFrame(blob), "image/jpeg", 0.7);
    }, 500);
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

      {/* The ONLY visible UI: tiny indicator, top-left corner.
          Returns null when idle — completely invisible. */}
      <div className="absolute top-4 left-4 z-20">
        <ArgusIndicator state={indicatorState} />
      </div>
    </div>
  );
}
