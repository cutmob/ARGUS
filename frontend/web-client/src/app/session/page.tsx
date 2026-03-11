"use client";

import { useState, useCallback, useEffect } from "react";
import { useArgusSession } from "@/hooks/useArgusSession";
import { useCameraContext } from "@/hooks/useCameraContext";
import { useWakeWord } from "@/hooks/useWakeWord";
import { speakResponse } from "@/lib/tts";
import { ContextSelector } from "@/components/ContextSelector";
import { DemoGate } from "@/components/DemoGate";
import { SmartphoneSession } from "@/components/session-smartphone/SmartphoneSession";
import { CCTVSession } from "@/components/session-cctv/CCTVSession";
import { ARSession } from "@/components/session-ar/ARSession";
import type { CameraContext } from "@/lib/cameraContext";

export default function SessionPage() {
  const [inspectionMode, setInspectionMode] = useState("construction");
  const [overlaysVisible, setOverlaysVisible] = useState(true);
  const [gated, setGated] = useState(
    () => typeof window !== "undefined" && !localStorage.getItem("argus_demo_token")
  );
  const session = useArgusSession();
  const { context, detecting } = useCameraContext();
  const [manualContext, setManualContext] = useState<CameraContext | null>(null);

  // Wake word only starts — never stops. Stops require an explicit voice command
  // ("stop", "end") so that saying "argus" during an active session doesn't
  // accidentally interrupt it (e.g. "argus, what do you see?").
  const handleWake = useCallback(() => {
    if (!session.isInspecting) {
      session.startInspection(inspectionMode);
      speakResponse("On it.");
    }
  }, [session, inspectionMode]);

  useWakeWord({ onWake: handleWake, word: "argus" });

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

  // Toggle overlays with "O" key (non-AR modes)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "o") setOverlaysVisible((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeContext = manualContext ?? context;

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
    session.switchMode(m);
  };

  if (activeContext === "smartphone") {
    return (
      <SmartphoneSession
        session={session}
        mode={inspectionMode}
        onModeChange={handleModeChange}
        overlaysVisible={overlaysVisible}
      />
    );
  }

  if (activeContext === "ar") {
    return <ARSession session={session} mode={inspectionMode} onModeChange={handleModeChange} />;
  }

  // Default: CCTV / desktop
  return (
    <CCTVSession
      session={session}
      mode={inspectionMode}
      onModeChange={handleModeChange}
      overlaysVisible={overlaysVisible}
    />
  );
}
