"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useArgusSession } from "@/hooks/useArgusSession";
import { useCameraContext } from "@/hooks/useCameraContext";
import { useWakeWord } from "@/hooks/useWakeWord";
import { speakResponse } from "@/lib/tts";
import { INSPECTION_MODES, modeLabel } from "@/lib/modes";
import { ContextSelector } from "@/components/ContextSelector";
import { DemoGate } from "@/components/DemoGate";
import { SmartphoneSession } from "@/components/session-smartphone/SmartphoneSession";
import { CCTVSession } from "@/components/session-cctv/CCTVSession";
import { ARSession } from "@/components/session-ar/ARSession";
import type { GlassMode } from "@/components/HazardOverlay";
import type { CameraContext } from "@/lib/cameraContext";

export default function SessionPage() {
  const [inspectionMode, setInspectionMode] = useState("construction");
  const [reportFormat, setReportFormat] = useState("pdf");
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [gated, setGated] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [openSelect, setOpenSelect] = useState<"context" | "mode" | "format" | null>(null);
  const [reportViewOpen, setReportViewOpen] = useState(false);
  const [reportTile, setReportTile] = useState<{ text: string; at: number } | null>(null);
  const [latestReport, setLatestReport] = useState<{ text: string; reportId?: string; at: number } | null>(null);
  const [cctvVoiceInputEnabled, setCctvVoiceInputEnabled] = useState(false);
  const [cctvVoiceOutputEnabled, setCctvVoiceOutputEnabled] = useState(false);
  const [glassMode, setGlassMode] = useState<GlassMode>("dark");
  const [demoContext, setDemoContext] = useState<CameraContext>("cctv");
  const [videoSource, setVideoSource] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualContext, setManualContext] = useState<CameraContext | null>(null);

  useEffect(() => {
    setGated(!localStorage.getItem("argus_demo_token"));
    const savedMode = localStorage.getItem("argus_mode");
    const savedContext = localStorage.getItem("argus_context") as CameraContext | null;
    const savedFormat = localStorage.getItem("argus_report_format");
    const savedGlassMode = localStorage.getItem("argus_glass_mode");
    const savedCctvVoiceInput = localStorage.getItem("argus_cctv_voice_input");
    const savedCctvVoiceOutput = localStorage.getItem("argus_cctv_voice_output");
    if (savedMode) setInspectionMode(savedMode);
    if (savedContext) {
      setDemoContext(savedContext);
      setManualContext(savedContext);
    }
    if (savedFormat) setReportFormat(savedFormat);
    if (savedGlassMode === "dark" || savedGlassMode === "light") setGlassMode(savedGlassMode);
    if (savedCctvVoiceInput) setCctvVoiceInputEnabled(savedCctvVoiceInput === "true");
    if (savedCctvVoiceOutput) setCctvVoiceOutputEnabled(savedCctvVoiceOutput === "true");
  }, []);
  const session = useArgusSession();
  const { context, detecting } = useCameraContext();

  // Wake word only starts — never stops. Stops require an explicit voice command
  // ("stop", "end") so that saying "argus" during an active session doesn't
  // accidentally interrupt it (e.g. "argus, what do you see?").
  const handleWake = useCallback(() => {
    if (!session.isInspecting) {
      session.startInspection(inspectionMode);
      speakResponse("On it.");
    }
  }, [session, inspectionMode]);

  const wakeWordEnabled = (manualContext ?? context) !== "ar";
  useWakeWord({ onWake: handleWake, word: "argus", enabled: wakeWordEnabled });

  // Toggle overlays with "O" key (non-AR modes)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "o") setOverlaysVisible((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (videoSource) URL.revokeObjectURL(videoSource);
    };
  }, [videoSource]);

  useEffect(() => {
    if (!controlsOpen) setOpenSelect(null);
  }, [controlsOpen]);

  useEffect(() => {
    if (!session.lastAgentResponse) return;
    const r = session.lastAgentResponse;
    const text = r.text.trim();
    const reportLike =
      r.type === "report" ||
      !!r.reportId ||
      text.toLowerCase().includes("report generated") ||
      text.toLowerCase().includes("report ready");
    if (!reportLike) return;

    const nextReport = {
      text: text || `Report generated (${reportFormat.toUpperCase()}).`,
      reportId: r.reportId,
      at: r.at,
    };
    setLatestReport(nextReport);
    setReportTile({ text: `Report ready • ${reportFormat.toUpperCase()}`, at: Date.now() });

    const timeout = setTimeout(() => {
      setReportTile((prev) => (prev && Date.now() - prev.at >= 4900 ? null : prev));
    }, 5000);
    return () => clearTimeout(timeout);
  }, [session.lastAgentResponse, reportFormat]);

  const activeContext = manualContext ?? context;

  useEffect(() => {
    if (activeContext === "cctv") {
      session.setVoiceOutputEnabled(cctvVoiceOutputEnabled);
    } else {
      session.setVoiceOutputEnabled(true);
    }
  }, [activeContext, cctvVoiceOutputEnabled, session]);

  useEffect(() => {
    if (activeContext !== "ar" && activeContext !== "smartphone") return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {});
  }, [activeContext]);

  if (gated || session.unauthorized) {
    return (
      <DemoGate
        onAccess={() => {
          setGated(false);
          if (session.unauthorized) session.resetAuth();
        }}
      />
    );
  }

  if (detecting) {
    return (
      <div className="h-screen w-screen bg-argus-bg flex items-center justify-center">
        <span className="font-display text-xs font-medium text-argus-muted tracking-[0.35em] uppercase">
          Detecting environment
        </span>
      </div>
    );
  }

  if (activeContext === "unknown") {
    return <ContextSelector onSelect={setManualContext} />;
  }

  const handleModeChange = (m: string) => {
    setInspectionMode(m);
    localStorage.setItem("argus_mode", m);
    session.switchMode(m);
  };

  const handleVideoPick = (file: File | null) => {
    if (!file) return;
    if (videoSource) URL.revokeObjectURL(videoSource);
    const url = URL.createObjectURL(file);
    setVideoSource(url);
    setVideoName(file.name);
  };

  const startDemo = () => {
    setManualContext(demoContext);
    localStorage.setItem("argus_context", demoContext);
    if (!session.isInspecting) session.startInspection(inspectionMode);
  };

  const stopDemo = () => {
    if (session.isInspecting) session.stopInspection();
  };

  const setSharedGlassMode = (next: GlassMode) => {
    setGlassMode(next);
    localStorage.setItem("argus_glass_mode", next);
  };

  const sessionWithFormat = {
    ...session,
    generateReport: () => session.generateReport(reportFormat),
  };

  const controlAnchorClass =
    activeContext === "cctv" ? "top-12 right-4" : "top-14 right-4";
  const reportPanelTop = controlsOpen ? "11.25rem" : activeContext === "cctv" ? "6rem" : "7rem";

  const controlLauncher = (
    <div className={`fixed z-50 ${controlAnchorClass}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/*"
        className="hidden"
        onChange={(e) => handleVideoPick(e.target.files?.[0] ?? null)}
      />

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => (session.isInspecting ? stopDemo() : startDemo())}
          className="liquid-glass liquid-float liquid-pill liquid-enter h-8 px-3 font-mono text-[10px] tracking-[0.14em] uppercase liquid-title"
        >
          {session.isInspecting ? "Stop" : "Start"}
        </button>
        <button
          onClick={() => setControlsOpen((v) => !v)}
          className="liquid-glass liquid-float liquid-pill liquid-enter h-8 px-3 font-mono text-[10px] tracking-[0.14em] uppercase liquid-meta"
        >
          {demoContext} • {modeLabel(inspectionMode)} ▾
        </button>
      </div>

      {controlsOpen && (
        <div className="liquid-glass liquid-float liquid-enter mt-2 w-80 rounded-2xl p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <button
                onClick={() => setOpenSelect((v) => (v === "context" ? null : "context"))}
                className="liquid-glass liquid-float liquid-pill h-8 w-full px-2 font-mono text-[10px] uppercase liquid-title flex items-center justify-between"
              >
                <span>{demoContext}</span>
                <span className="liquid-meta">▾</span>
              </button>
              {openSelect === "context" && (
                <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-10 liquid-glass liquid-float liquid-enter liquid-menu liquid-menu-popover">
                  {(["cctv", "ar", "smartphone"] as CameraContext[]).map((ctx) => (
                    <button
                      key={ctx}
                      onClick={() => {
                        setDemoContext(ctx);
                        setManualContext(ctx);
                        setOpenSelect(null);
                      }}
                      className={`liquid-menu-item font-mono text-[10px] uppercase ${
                        demoContext === ctx ? "liquid-menu-item-active" : "liquid-meta"
                      }`}
                    >
                      {ctx === "smartphone" ? "mobile" : ctx}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setOpenSelect((v) => (v === "mode" ? null : "mode"))}
                className="liquid-glass liquid-float liquid-pill h-8 w-full px-2 font-mono text-[10px] uppercase liquid-title flex items-center justify-between"
              >
                <span>{modeLabel(inspectionMode)}</span>
                <span className="liquid-meta">▾</span>
              </button>
              {openSelect === "mode" && (
                <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-10 max-h-44 overflow-auto liquid-glass liquid-float liquid-enter liquid-menu liquid-menu-popover">
                  {INSPECTION_MODES.map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        handleModeChange(m);
                        setOpenSelect(null);
                      }}
                      className={`liquid-menu-item font-mono text-[10px] uppercase ${
                        inspectionMode === m ? "liquid-menu-item-active" : "liquid-meta"
                      }`}
                    >
                      {modeLabel(m)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2">
            <div className="relative">
              <button
                onClick={() => setOpenSelect((v) => (v === "format" ? null : "format"))}
                className="liquid-glass liquid-float liquid-pill h-8 w-full px-2 font-mono text-[10px] uppercase liquid-title flex items-center justify-between"
              >
                <span>{reportFormat}</span>
                <span className="liquid-meta">▾</span>
              </button>
              {openSelect === "format" && (
                <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-10 liquid-glass liquid-float liquid-enter liquid-menu liquid-menu-popover">
                  {["pdf", "word", "txt", "json", "csv", "html", "webhook"].map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setReportFormat(f);
                        localStorage.setItem("argus_report_format", f);
                        setOpenSelect(null);
                      }}
                      className={`liquid-menu-item font-mono text-[10px] uppercase ${
                        reportFormat === f ? "liquid-menu-item-active" : "liquid-meta"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="liquid-glass liquid-float liquid-pill h-8 px-3 font-mono text-[10px] tracking-[0.14em] uppercase liquid-title"
              title={videoName || "Upload demo MP4"}
            >
              Upload
            </button>
            <button
              onClick={() => setSharedGlassMode(glassMode === "dark" ? "light" : "dark")}
              className="liquid-glass liquid-float liquid-pill h-8 px-3 font-mono text-[10px] tracking-[0.14em] uppercase liquid-title"
              title="Toggle glass theme"
            >
              {glassMode === "dark" ? "Dark" : "Light"}
            </button>
            <button
              onClick={() => {
                setReportViewOpen(true);
                setControlsOpen(false);
              }}
              className="liquid-glass liquid-float liquid-pill h-8 px-3 font-mono text-[10px] tracking-[0.14em] uppercase liquid-title"
            >
              Report
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const reportTileView = reportTile && (
    <button
      onClick={() => {
        setReportViewOpen(true);
        setReportTile(null);
        setControlsOpen(false);
      }}
      className="fixed bottom-5 right-4 z-50 liquid-glass liquid-float liquid-pill liquid-enter px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase liquid-title"
      title="Open report view"
    >
      {reportTile.text}
    </button>
  );

  const reportPanelView = reportViewOpen && (
    <div
      className="fixed right-4 z-50 w-80 max-w-[calc(100vw-2rem)] liquid-glass liquid-float liquid-enter rounded-2xl p-3"
      style={{ top: reportPanelTop }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase liquid-meta">Report View</p>
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase liquid-meta mt-1">
            Format {reportFormat.toUpperCase()}
          </p>
        </div>
        <button
          onClick={() => setReportViewOpen(false)}
          className="liquid-glass liquid-float liquid-pill px-2 py-1 font-mono text-[10px] tracking-[0.14em] uppercase liquid-title"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-2 liquid-glass liquid-float rounded-xl p-2.5">
        {latestReport ? (
          <>
            <p className="font-sans text-xs leading-relaxed liquid-title">
              {latestReport.text || "Report generated and ready."}
            </p>
            {latestReport.reportId && (
              <p className="font-mono text-[10px] mt-1 liquid-meta">ID {latestReport.reportId}</p>
            )}
          </>
        ) : (
          <p className="font-sans text-xs leading-relaxed liquid-meta">
            No report yet. Say “generate report”, then “open report view”.
          </p>
        )}
      </div>
    </div>
  );

  if (activeContext === "smartphone") {
    return (
      <>
        {controlLauncher}
        {reportTileView}
        {reportPanelView}
        <SmartphoneSession
          session={sessionWithFormat}
          mode={inspectionMode}
          onModeChange={handleModeChange}
          overlaysVisible={overlaysVisible}
          videoSource={videoSource}
          glassMode={glassMode}
          onGlassModeChange={setSharedGlassMode}
        />
      </>
    );
  }

  if (activeContext === "ar") {
    return (
      <>
        {controlLauncher}
        {reportTileView}
        {reportPanelView}
        <ARSession
          session={sessionWithFormat}
          mode={inspectionMode}
          onModeChange={handleModeChange}
          videoSource={videoSource}
          glassMode={glassMode}
          onGlassModeChange={setSharedGlassMode}
          onOpenReportView={() => {
            setReportViewOpen(true);
            setReportTile(null);
          }}
          onCloseReportView={() => setReportViewOpen(false)}
        />
      </>
    );
  }

  // Default: CCTV / desktop
  return (
    <>
      {controlLauncher}
      {reportTileView}
      {reportPanelView}
      <CCTVSession
        session={sessionWithFormat}
        mode={inspectionMode}
        onModeChange={handleModeChange}
        overlaysVisible={overlaysVisible}
        videoSource={videoSource}
        glassMode={glassMode}
        onGlassModeChange={setSharedGlassMode}
        voiceInputEnabled={cctvVoiceInputEnabled}
        voiceOutputEnabled={cctvVoiceOutputEnabled}
        onVoiceInputChange={(enabled: boolean) => {
          setCctvVoiceInputEnabled(enabled);
          localStorage.setItem("argus_cctv_voice_input", String(enabled));
        }}
        onVoiceOutputChange={(enabled: boolean) => {
          setCctvVoiceOutputEnabled(enabled);
          localStorage.setItem("argus_cctv_voice_output", String(enabled));
        }}
      />
    </>
  );
}
