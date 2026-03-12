"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useVoiceCommands } from "@/hooks/useVoiceCommands";
import { speakResponse } from "@/lib/tts";
import { ArgusIndicator } from "@/components/ArgusIndicator";
import { HazardOverlay, type GlassMode } from "@/components/HazardOverlay";
import { INSPECTION_MODES } from "@/lib/modes";
import { resolveVoiceIntent } from "@/lib/voiceIntent";
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
  glassMode: externalGlassMode,
  onGlassModeChange,
  onOpenReportView,
  onCloseReportView,
}: ARSessionProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlaysVisible, setOverlaysVisible] = useState(false);
  const [localGlassMode, setLocalGlassMode] = useState<GlassMode>("dark");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);
  ttsEnabledRef.current = ttsEnabled;

  // Wrapped speak — respects mute state
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (ttsEnabledRef.current) speakResponse(text, onEnd);
    else onEnd?.();
  }, []);

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
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = videoSource;
        videoRef.current.loop = true;
        videoRef.current.muted = true;
        void videoRef.current.play().catch(() => {});
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
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
    };
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

  /* ── Voice commands (always active — no button to toggle) ── */
  const handleVoiceCommand = useCallback(
    (transcript: string) => {
      const intent = resolveVoiceIntent(transcript);
      switch (intent.type) {
        case "start_inspection":
          session.startInspection(mode);
          speak("On it.");
          break;
        case "stop_inspection":
          session.stopInspection();
          speak("Stopped.");
          break;
        case "open_report":
          onOpenReportView?.();
          speak("Report view open.");
          break;
        case "close_report":
          onCloseReportView?.();
          speak("Report view dismissed.");
          break;
        case "generate_report":
          session.generateReport();
          speak("Generating report.");
          break;
        case "query_status": {
          const n = session.hazards.length;
          speak(`${n} hazard${n !== 1 ? "s" : ""} detected. Risk level ${session.riskLevel}.`);
          break;
        }
        case "operator_actions":
          session.requestActions();
          speak("Generating top actions now.");
          break;
        case "clear_hazards":
          session.clearHazards();
          speak("Cleared.");
          break;
        case "describe_scene":
          if (session.hazards.length === 0) {
            speak("No hazards detected yet.");
          } else {
            const top = session.hazards.slice(0, 3);
            const summary = top.map((h) => h.description).join(". ");
            speak(`${session.hazards.length} hazard${session.hazards.length !== 1 ? "s" : ""}. ${summary}`);
          }
          break;
        case "switch_mode":
          if (intent.mode) {
            const matched = INSPECTION_MODES.find((m) => m === intent.mode);
            if (matched) {
              onModeChange(matched);
              speak(`Switching to ${matched}.`);
            }
          }
          break;
        case "toggle_overlays":
          setOverlaysVisible((v) => {
            speak(v ? "Overlays hidden." : "Overlays visible.");
            return !v;
          });
          break;
        case "set_glass_light":
          setGlassMode("light");
          speak("Light glass.");
          break;
        case "set_glass_dark":
          setGlassMode("dark");
          speak("Dark glass.");
          break;
        case "mute_voice":
          window.speechSynthesis?.cancel();
          setTtsEnabled(false);
          break;
        case "unmute_voice":
          setTtsEnabled(true);
          speakResponse("Voice on.");
          break;
        default:
          session.sendNaturalLanguageCommand?.(transcript);
          break;
      }
    },
    [session, mode, onModeChange, onOpenReportView, onCloseReportView, speak]
  );

  const { listening, supported } = useVoiceCommands({
    onCommand: handleVoiceCommand,
    enabled: micEnabled,
  });

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
        <button
          onClick={() => {
            if (!supported) return;
            setMicEnabled((v) => !v);
          }}
          className="liquid-glass liquid-float liquid-pill liquid-enter px-2 py-1 font-mono text-[9px] tracking-[0.2em] uppercase"
          style={{
            color: !supported
              ? "rgba(239,68,68,0.9)"
              : micEnabled && listening
              ? "#FF5F1F"
              : "rgba(255,255,255,0.5)",
            opacity: supported ? 1 : 0.75,
            cursor: supported ? "pointer" : "not-allowed",
          }}
          title={supported ? "Toggle voice command microphone" : "Speech recognition unsupported in this browser"}
        >
          {supported ? (micEnabled ? "Mic On" : "Mic Off") : "Mic N/A"}
        </button>
      </div>
    </div>
  );
}
