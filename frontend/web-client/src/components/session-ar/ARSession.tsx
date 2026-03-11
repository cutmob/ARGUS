"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { speakResponse } from "@/lib/tts";
import { ArgusIndicator } from "@/components/ArgusIndicator";
import { HazardOverlay, type GlassMode } from "@/components/HazardOverlay";
import { INSPECTION_MODES } from "@/lib/modes";
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
    clearHazards: () => void;
  };
  mode: string;
  onModeChange: (mode: string) => void;
}

/**
 * AR Glasses mode — near-invisible UI.
 *
 * The wearer should NOT see a dashboard. All interaction is voice-driven
 * (wake word "argus" handled at page level, plus explicit commands here).
 * The only visual element is a tiny ARGUS indicator in the top-left corner
 * that appears when processing or speaking, and vanishes when idle.
 */
export function ARSession({ session, mode, onModeChange }: ARSessionProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlaysVisible, setOverlaysVisible] = useState(false);
  const [glassMode, setGlassMode] = useState<GlassMode>("dark");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);
  ttsEnabledRef.current = ttsEnabled;

  // Wrapped speak — respects mute state
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (ttsEnabledRef.current) speakResponse(text, onEnd);
    else onEnd?.();
  }, []);

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

      // ── Inspection control ──────────────────────────────────────
      if (t.includes("inspect") || t.includes("start")) {
        session.startInspection(mode);
        speak("On it.");

      } else if (t.includes("stop") || t.includes("end")) {
        session.stopInspection();
        speak("Stopped.");

      } else if (t.includes("report")) {
        session.generateReport();
        speak("Generating report.");

      } else if (t.includes("status") || t.includes("how many") || t.includes("what's the")) {
        const n = session.hazards.length;
        speak(`${n} hazard${n !== 1 ? "s" : ""} detected. Risk level ${session.riskLevel}.`);

      // ── Clear / reset log ────────────────────────────────────────
      // Accepts: "clear", "reset", "clear log", "reset log", "clear hazards",
      //          "reset logging", "start fresh", "wipe", etc.
      } else if (
        t.includes("clear") || t.includes("reset") ||
        t.includes("wipe")  || t.includes("fresh")
      ) {
        session.clearHazards();
        speak("Cleared.");

      // ── Describe / what do you see ───────────────────────────────
      // Summarises current hazards from local state — no extra backend call
      } else if (
        t.includes("describe") || t.includes("what do you see") ||
        t.includes("what's there") || t.includes("what can you see") ||
        t.includes("look") || t.includes("analyse") || t.includes("analyze") ||
        t.includes("summary") || t.includes("summarise") || t.includes("summarize")
      ) {
        if (session.hazards.length === 0) {
          speak("No hazards detected yet.");
        } else {
          const top = session.hazards.slice(0, 3);
          const summary = top.map((h) => h.description).join(". ");
          speak(`${session.hazards.length} hazard${session.hazards.length !== 1 ? "s" : ""}. ${summary}`);
        }

      // ── Mode switching ───────────────────────────────────────────
      // "switch to electrical", "change to kitchen mode", "elevator", etc.
      } else if (t.includes("switch") || t.includes("change") || t.includes("mode")) {
        const matched = INSPECTION_MODES.find((m) => t.includes(m) || t.includes(m.replace("-", " ")));
        if (matched) {
          onModeChange(matched);
          speak(`Switching to ${matched}.`);
        }

      // ── Overlays ─────────────────────────────────────────────────
      } else if (t.includes("overlay") || t.includes("show") || t.includes("hide")) {
        setOverlaysVisible((v) => {
          speak(v ? "Overlays hidden." : "Overlays visible.");
          return !v;
        });

      } else if (t.includes("light") || t.includes("bright")) {
        setGlassMode("light");
        speak("Light glass.");

      } else if (t.includes("dark")) {
        setGlassMode("dark");
        speak("Dark glass.");

      // ── Mute / unmute ────────────────────────────────────────────
      } else if (t.includes("mute") && !t.includes("unmute")) {
        window.speechSynthesis?.cancel();
        setTtsEnabled(false);
        // Can't speak confirmation when muting — just cancel

      } else if (t.includes("unmute") || t.includes("sound on") || t.includes("voice on")) {
        setTtsEnabled(true);
        speakResponse("Voice on."); // bypass mute check intentionally
      }
    },
    [session, mode, onModeChange, speak]
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
