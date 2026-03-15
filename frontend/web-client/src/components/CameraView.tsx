"use client";

import { useRef, useEffect, useState } from "react";
import { EventPillOverlay } from "@/components/EventPillOverlay";
import { HazardOverlay, type GlassMode } from "@/components/HazardOverlay";
import type { Hazard, Overlay } from "@/lib/types";

interface CameraViewProps {
  hazards: Hazard[];
  overlays: Overlay[];
  overlaysVisible?: boolean;
  overlaysFading?: boolean;
  glassMode?: GlassMode;
  videoSource?: string | null;
  /** Original File object — used to recreate blob URL if revoked */
  videoFile?: File | null;
  /** Specific camera deviceId to use (from useCameraDevices). Empty/undefined = default. */
  deviceId?: string;
  onFrame: (data: Blob) => void;
  pillExpandMode?: "click" | "tap" | "none";
  pillPlacementMode?: "follow" | "stack-top-left";
}

export function CameraView({
  hazards,
  overlays,
  overlaysVisible = true,
  overlaysFading = false,
  glassMode = "dark",
  videoSource,
  videoFile,
  deviceId,
  onFrame,
  pillExpandMode = "click",
  pillPlacementMode = "follow",
}: CameraViewProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    async function startCamera() {
      if (videoSource) {
        // Stop any active camera stream first
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const vid = videoRef.current;
        if (vid) {
          vid.srcObject = null;
          vid.src = videoSource;
          vid.loop = true;
          vid.muted = true;
          vid.playsInline = true;
          // Try multiple events — canplay doesn't always fire for blob URLs
          const tryPlay = () => {
            vid.removeEventListener("canplay", tryPlay);
            vid.removeEventListener("loadeddata", tryPlay);
            void vid.play().catch((err) => {
              console.warn("[ARGUS] Video play failed:", err);
            });
          };
          const handleError = () => {
            vid.removeEventListener("error", handleError);
            // Blob URL may have been revoked (React StrictMode, HMR, etc.)
            // Try recreating from the original File object before falling back to webcam
            if (videoFile) {
              console.warn("[ARGUS] Video blob URL failed, recreating from File object");
              const newUrl = URL.createObjectURL(videoFile);
              vid.src = newUrl;
              vid.load();
              return;
            }
            console.warn("[ARGUS] Video source failed to load, falling back to camera");
            vid.removeAttribute("src");
            vid.srcObject = null;
            navigator.mediaDevices
              .getUserMedia({ video: { width: 1280, height: 720, facingMode: "environment" }, audio: false })
              .then((stream) => {
                streamRef.current = stream;
                if (videoRef.current) videoRef.current.srcObject = stream;
              })
              .catch(() => {});
          };
          vid.addEventListener("canplay", tryPlay);
          vid.addEventListener("loadeddata", tryPlay);
          vid.addEventListener("error", handleError);
          vid.load();
        }
        return;
      }

      try {
        const videoConstraints: MediaTrackConstraints = {
          width: 1280,
          height: 720,
        };
        // Use specific device if provided, otherwise default to environment camera
        if (deviceId) {
          videoConstraints.deviceId = { exact: deviceId };
        } else {
          videoConstraints.facingMode = "environment";
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("[ARGUS] Camera access denied:", err);
      }
    }
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const vid = videoRef.current;
      if (vid) {
        vid.pause();
        vid.removeAttribute("src");
        vid.srcObject = null;
        vid.load();
      }
    };
  }, [videoSource, deviceId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (!isNaN(video.duration)) {
        setDuration(video.duration);
      }
    };
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [videoSource]);

  const handleSeek = (value: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const clamped = Math.max(0, Math.min(duration, value));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const formatTime = (t: number) => {
    if (!isFinite(t) || t <= 0) return "0:00";
    const minutes = Math.floor(t / 60);
    const seconds = Math.floor(t % 60)
      .toString()
      .padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Match the canvas to the element's rendered size so bounding boxes
      // from Gemini align with what the overlay sees (object-cover crop).
      const el = video.getBoundingClientRect();
      const elW = el.width;
      const elH = el.height;
      const vW  = video.videoWidth;
      const vH  = video.videoHeight;
      if (!vW || !vH || !elW || !elH) return;

      // Compute the object-cover source rect (same math the browser uses)
      const scale = Math.max(elW / vW, elH / vH);
      const srcW  = elW / scale;
      const srcH  = elH / scale;
      const srcX  = (vW - srcW) / 2;
      const srcY  = (vH - srcH) / 2;

      canvas.width  = Math.round(srcW);
      canvas.height = Math.round(srcH);
      ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { if (blob) onFrame(blob); }, "image/jpeg", 0.7);
    }, 1000);
    return () => clearInterval(interval);
  }, [onFrame]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      <HazardOverlay overlays={overlays} visible={overlaysVisible} glassMode={glassMode} fading={overlaysFading} />
      <EventPillOverlay
        hazards={hazards}
        overlays={overlays}
        visible={overlaysVisible}
        glassMode={glassMode}
        expandMode={pillExpandMode}
        placementMode={pillPlacementMode}
      />

      <div className="feed-corner feed-corner-tl" />
      <div className="feed-corner feed-corner-tr" />
      <div className="feed-corner feed-corner-bl" />
      <div className="feed-corner feed-corner-br" />

      {/* LIVE indicator */}
      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 pointer-events-none">
        <div className="w-1 h-1 rounded-full" style={{ background: "#FF5F1F" }} />
        <span className="font-mono text-xs tracking-widest" style={{ color: "rgba(255,255,255,0.2)" }}>
          LIVE
        </span>
      </div>

      {/* Scrubber for uploaded video */}
      {videoSource && duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-2 pt-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center gap-2">
          <span className="font-mono text-[10px] text-white/40 w-10 tabular-nums">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="w-full accent-[#FF5F1F]"
          />
          <span className="font-mono text-[10px] text-white/40 w-10 text-right tabular-nums">
            {formatTime(duration)}
          </span>
        </div>
      )}
    </div>
  );
}
