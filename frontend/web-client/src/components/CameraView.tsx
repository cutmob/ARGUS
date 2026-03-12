"use client";

import { useRef, useEffect } from "react";
import { HazardOverlay, type GlassMode } from "@/components/HazardOverlay";
import type { Overlay } from "@/lib/types";

interface CameraViewProps {
  overlays: Overlay[];
  overlaysVisible?: boolean;
  glassMode?: GlassMode;
  videoSource?: string | null;
  onFrame: (data: Blob) => void;
}

export function CameraView({
  overlays,
  overlaysVisible = true,
  glassMode = "dark",
  videoSource,
  onFrame,
}: CameraViewProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    async function startCamera() {
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

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: "environment" },
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
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
    };
  }, [videoSource]);

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
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      <HazardOverlay overlays={overlays} visible={overlaysVisible} glassMode={glassMode} />

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
    </div>
  );
}
