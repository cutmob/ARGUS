"use client";

interface StatusBarProps {
  connected: boolean;
  mode: string;
  hazardCount: number;
  riskLevel: string;
}

const RISK_STYLES: Record<string, string> = {
  critical: "text-argus-critical",
  high:     "text-argus-danger",
  medium:   "text-argus-amber",
  low:      "text-argus-safe",
};

export function StatusBar({ connected, mode, hazardCount, riskLevel }: StatusBarProps) {
  const riskStyle = RISK_STYLES[riskLevel] ?? "text-argus-text";

  return (
    <header className="h-11 bg-argus-surface border-b border-argus-border flex items-center justify-between px-5 shrink-0">
      {/* Left — brand + connection */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          {/* Eye icon */}
          <svg className="w-5 h-5 text-argus-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span className="font-display font-bold text-sm tracking-[0.2em] text-white">ARGUS</span>
        </div>

        <div className="w-px h-4 bg-argus-border" />

        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center w-2.5 h-2.5">
            {connected && (
              <span className="absolute inline-flex w-full h-full rounded-full bg-argus-safe opacity-75 animate-ping-slow" />
            )}
            <span className={`relative w-2 h-2 rounded-full ${connected ? "bg-argus-safe" : "bg-argus-muted"}`} />
          </div>
          <span className={`font-mono text-xs font-semibold tracking-widest ${connected ? "text-argus-safe" : "text-argus-muted"}`}>
            {connected ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* Right — telemetry */}
      <div className="flex items-center gap-6 font-mono text-xs">
        <div className="flex items-center gap-2 text-argus-muted">
          <span className="tracking-widest">MODE</span>
          <span className="text-white font-bold uppercase">{mode}</span>
        </div>
        <div className="w-px h-4 bg-argus-border" />
        <div className="flex items-center gap-2 text-argus-muted">
          <span className="tracking-widest">HAZARDS</span>
          <span className={`font-bold ${hazardCount > 0 ? "text-argus-amber" : "text-white"}`}>
            {hazardCount}
          </span>
        </div>
        <div className="w-px h-4 bg-argus-border" />
        <div className="flex items-center gap-2 text-argus-muted">
          <span className="tracking-widest">RISK</span>
          <span className={`font-bold uppercase ${riskStyle}`}>
            {riskLevel || "—"}
          </span>
        </div>
      </div>
    </header>
  );
}
