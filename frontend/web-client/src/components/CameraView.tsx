"use client";

import { useRef, useEffect, useCallback } from "react";

interface Overlay {
  type: string;
  label: string;
  bbox?: { x: number; y: number; width: number; height: number };
  severity: string;
  color: string;
}

interface CameraViewProps {
  overlays: Overlay[];
  onFrame: (data: Blob) => void;
}

export function CameraView({ overlays, onFrame }: CameraViewProps) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);

  // Initialize camera
  useEffect(() => {
    async function startCamera() {
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
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  // Frame capture loop — 3 s to match backend sampler
  useEffect(() => {
    const interval = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx    = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width  = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);

      canvas.toBlob(
        (blob) => { if (blob) onFrame(blob); },
        "image/jpeg",
        0.7
      );
    }, 3000);
    return () => clearInterval(interval);
  }, [onFrame]);

  // Draw overlays
  const drawOverlays = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    for (const overlay of overlays) {
      if (!overlay.bbox) continue;
      const { x, y, width, height } = overlay.bbox;

      // Box
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth   = 2;
      ctx.strokeRect(x, y, width, height);

      // Corner brackets
      const cs = 12;
      ctx.lineWidth = 3;
      const corners = [
        [x, y, cs, 0, 0, cs],
        [x + width, y, -cs, 0, 0, cs],
        [x, y + height, cs, 0, 0, -cs],
        [x + width, y + height, -cs, 0, 0, -cs],
      ] as const;
      for (const [cx, cy, dx1, dy1, dx2, dy2] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx + dx1, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy2);
        ctx.stroke();
      }

      // Label
      ctx.font = "bold 11px 'JetBrains Mono', monospace";
      const labelText  = `${overlay.severity.toUpperCase()} · ${overlay.label}`;
      const textWidth  = ctx.measureText(labelText).width;
      const padX       = 8;
      const padY       = 5;
      const labelH     = 20;
      ctx.fillStyle    = overlay.color;
      ctx.fillRect(x, y - labelH - padY, textWidth + padX * 2, labelH + padY);
      ctx.fillStyle    = "#000";
      ctx.fillText(labelText, x + padX, y - padY - 4);
    }
  }, [overlays]);

  useEffect(() => { drawOverlays(); }, [overlays, drawOverlays]);

  return (
    <div className="relative w-full h-full bg-argus-bg overflow-hidden">
      {/* Live camera */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />

      {/* Overlay canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Subtle grid */}
      <div className="absolute inset-0 camera-grid pointer-events-none" />

      {/* Scan line */}
      <div className="scan-line" />

      {/* Corner HUD brackets */}
      <div className="absolute top-4 left-4 w-12 h-12 bracket pointer-events-none" />
      <div className="absolute top-4 right-4 w-12 h-12 pointer-events-none"
           style={{borderTop: "2px solid rgba(0,194,255,0.4)", borderRight: "2px solid rgba(0,194,255,0.4)"}} />
      <div className="absolute bottom-4 left-4 w-12 h-12 pointer-events-none"
           style={{borderBottom: "2px solid rgba(0,194,255,0.4)", borderLeft: "2px solid rgba(0,194,255,0.4)"}} />
      <div className="absolute bottom-4 right-4 w-12 h-12 pointer-events-none"
           style={{borderBottom: "2px solid rgba(0,194,255,0.4)", borderRight: "2px solid rgba(0,194,255,0.4)"}} />

      {/* ARGUS watermark */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-argus-bg/60 backdrop-blur-sm px-3 py-1.5 rounded-full border border-argus-border">
        <div className="relative w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-argus-accent animate-ping-slow opacity-60" />
          <span className="relative block w-2 h-2 rounded-full bg-argus-accent accent-glow" />
        </div>
        <span className="font-mono text-xs font-bold tracking-[0.25em] text-argus-accent">
          ARGUS LIVE
        </span>
      </div>
    </div>
  );
}
