"use client";

const INSPECTION_MODES = [
  { id: "elevator",     label: "Elevator",     icon: "↑" },
  { id: "construction", label: "Construction", icon: "⛏" },
  { id: "facility",     label: "Facility",     icon: "🏭" },
  { id: "warehouse",    label: "Warehouse",    icon: "📦" },
  { id: "restaurant",   label: "Restaurant",   icon: "🍽" },
  { id: "factory",      label: "Factory",      icon: "⚙" },
  { id: "general",      label: "General",      icon: "◎" },
];

interface ControlPanelProps {
  mode: string;
  onModeChange: (mode: string) => void;
  onStartInspection: () => void;
  onStopInspection: () => void;
  onGenerateReport: () => void;
  isInspecting: boolean;
}

export function ControlPanel({
  mode,
  onModeChange,
  onStartInspection,
  onStopInspection,
  onGenerateReport,
  isInspecting,
}: ControlPanelProps) {
  return (
    <div className="p-4 border-b border-argus-border space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-argus-accent rounded-full" />
        <span className="font-mono text-xs font-bold tracking-[0.2em] text-argus-accent uppercase">
          Control
        </span>
      </div>

      {/* Mode grid */}
      <div>
        <p className="font-mono text-[10px] tracking-widest text-argus-muted mb-2">
          INSPECTION MODULE
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {INSPECTION_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => !isInspecting && onModeChange(m.id)}
              disabled={isInspecting}
              className={`flex items-center gap-1.5 px-3 py-2 rounded text-xs font-mono font-bold transition-all
                ${mode === m.id
                  ? "bg-argus-accent/10 border border-argus-accent text-argus-accent"
                  : "border border-argus-border text-argus-muted hover:border-argus-accent/50 hover:text-argus-text"
                }
                disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <span className="text-base leading-none">{m.icon}</span>
              <span className="truncate">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-2">
        {!isInspecting ? (
          <button
            onClick={onStartInspection}
            className="w-full flex items-center justify-center gap-2 bg-argus-accent text-argus-bg font-mono font-bold text-sm py-2.5 px-4 rounded transition-all hover:bg-argus-accent/90 active:scale-95"
          >
            <span className="w-2 h-2 rounded-full bg-argus-bg" />
            START INSPECTION
          </button>
        ) : (
          <button
            onClick={onStopInspection}
            className="w-full flex items-center justify-center gap-2 bg-argus-danger/10 border border-argus-danger text-argus-danger font-mono font-bold text-sm py-2.5 px-4 rounded transition-all hover:bg-argus-danger/20 active:scale-95"
          >
            <span className="w-2 h-2 rounded-full bg-argus-danger" />
            STOP
          </button>
        )}

        <button
          onClick={onGenerateReport}
          disabled={!isInspecting}
          className="w-full flex items-center justify-center gap-2 border border-argus-border text-argus-muted font-mono text-sm py-2.5 px-4 rounded transition-all hover:border-argus-accent/50 hover:text-argus-text disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          GENERATE REPORT
        </button>
      </div>

      {/* Voice hint */}
      <p className="font-mono text-[10px] text-argus-muted/60 text-center">
        Say <span className="text-argus-accent/70">"generate report"</span> to export via voice
      </p>
    </div>
  );
}
