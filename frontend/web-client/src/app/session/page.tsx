"use client";

import { useState } from "react";
import { CameraView } from "@/components/CameraView";
import { ControlPanel } from "@/components/ControlPanel";
import { HazardList } from "@/components/HazardList";
import { StatusBar } from "@/components/StatusBar";
import { useArgusSession } from "@/hooks/useArgusSession";

export default function SessionPage() {
  const [inspectionMode, setInspectionMode] = useState<string>("general");
  const session = useArgusSession();

  return (
    <main className="h-screen w-screen flex flex-col bg-argus-bg overflow-hidden">
      <StatusBar
        connected={session.connected}
        mode={inspectionMode}
        hazardCount={session.hazards.length}
        riskLevel={session.riskLevel}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Camera feed */}
        <div className="flex-1 relative">
          <CameraView
            overlays={session.overlays}
            onFrame={session.sendFrame}
          />
        </div>

        {/* Right panel */}
        <aside className="w-72 flex flex-col bg-argus-panel border-l border-argus-border overflow-hidden">
          <ControlPanel
            mode={inspectionMode}
            onModeChange={(m) => { setInspectionMode(m); session.switchMode(m); }}
            onStartInspection={() => session.startInspection(inspectionMode)}
            onStopInspection={session.stopInspection}
            onGenerateReport={session.generateReport}
            isInspecting={session.isInspecting}
          />

          <HazardList hazards={session.hazards} />
        </aside>
      </div>
    </main>
  );
}
