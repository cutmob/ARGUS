"use client";

interface Hazard {
  id: string;
  description: string;
  severity: string;
  confidence: number;
  detected_at: string;
}

interface HazardListProps {
  hazards: Hazard[];
}

const SEVERITY_CONFIG: Record<string, { border: string; badge: string; dot: string }> = {
  critical: {
    border: "border-l-argus-critical",
    badge:  "bg-argus-critical/10 text-argus-critical border border-argus-critical/30",
    dot:    "bg-argus-critical",
  },
  high: {
    border: "border-l-argus-danger",
    badge:  "bg-argus-danger/10 text-argus-danger border border-argus-danger/30",
    dot:    "bg-argus-danger",
  },
  medium: {
    border: "border-l-argus-amber",
    badge:  "bg-argus-amber/10 text-argus-amber border border-argus-amber/30",
    dot:    "bg-argus-amber",
  },
  low: {
    border: "border-l-argus-muted",
    badge:  "bg-argus-muted/10 text-argus-muted border border-argus-muted/30",
    dot:    "bg-argus-muted",
  },
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

export function HazardList({ hazards }: HazardListProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 flex items-center justify-between px-4 py-3 bg-argus-panel border-b border-argus-border z-10">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-argus-amber rounded-full" />
          <span className="font-mono text-xs font-bold tracking-[0.2em] text-argus-amber uppercase">
            Hazards
          </span>
        </div>
        <span className="font-mono text-xs bg-argus-surface text-argus-muted px-2 py-0.5 rounded-full border border-argus-border">
          {hazards.length}
        </span>
      </div>

      {/* List */}
      <div className="p-3 space-y-2">
        {hazards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-argus-muted/50">
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
            <p className="font-mono text-xs tracking-widest text-center">
              NO HAZARDS DETECTED
            </p>
          </div>
        ) : (
          hazards.map((hazard) => {
            const cfg = SEVERITY_CONFIG[hazard.severity] ?? SEVERITY_CONFIG.low;
            return (
              <div
                key={hazard.id}
                className={`border-l-2 ${cfg.border} pl-3 pr-3 py-2.5 bg-argus-surface rounded-r border border-l-0 border-argus-border hover:border-argus-border/70 transition-colors`}
              >
                {/* Top row */}
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ${cfg.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {hazard.severity.toUpperCase()}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px] text-argus-muted">
                      {Math.round(hazard.confidence * 100)}%
                    </span>
                    <span className="font-mono text-[10px] text-argus-muted/50">
                      {formatTime(hazard.detected_at)}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-argus-text leading-relaxed">
                  {hazard.description}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
