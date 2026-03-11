"use client";

import { useState } from "react";

interface DemoGateProps {
  onAccess: () => void;
}

export function DemoGate({ onAccess }: DemoGateProps) {
  const [code, setCode]     = useState("");
  const [error, setError]   = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);

    const wsUrl = (process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws")
      .replace(/^ws/, "http");
    const probeUrl = wsUrl.replace(/\/ws$/, "/api/v1/health");

    // Probe the backend with the token — a 401 means bad code, 200 means good
    try {
      const wsProbe = (process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws") +
        "?token=" + encodeURIComponent(code.trim()) + "&probe=1";
      const http = wsProbe.replace(/^ws/, "http");
      // We can't pre-validate via HTTP since the gate is on /ws (WebSocket only).
      // Instead: store the token and let the WebSocket handshake validate it.
      // If invalid, the backend returns 401 and the socket fires onerror → onclose.
      // We detect this in useArgusSession via the "unauthorized" state.
      localStorage.setItem("argus_demo_token", code.trim().toUpperCase());
      void probeUrl; void http;
      onAccess();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen w-screen bg-black flex flex-col items-center justify-center">
      <div className="w-full max-w-xs px-8">
        <div className="mb-10 text-center">
          <p
            className="font-display text-2xl font-black tracking-[0.25em] uppercase mb-1"
            style={{ color: "#FF5F1F" }}
          >
            ARGUS
          </p>
          <p
            className="font-mono text-xs tracking-[0.2em] uppercase"
            style={{ color: "#4a4a4a" }}
          >
            Demo Access
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(false); }}
            placeholder="ENTER CODE"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="w-full font-mono text-sm tracking-[0.2em] uppercase text-center py-4 px-4 bg-transparent focus:outline-none placeholder:opacity-20"
            style={{
              border: `1px solid ${error ? "#ef4444" : "#1c1c1c"}`,
              color: error ? "#ef4444" : "#f0f0f0",
              transition: "border-color 0.2s",
            }}
          />
          {error && (
            <p
              className="font-mono text-xs tracking-widest text-center uppercase"
              style={{ color: "#ef4444" }}
            >
              Invalid code
            </p>
          )}
          <button
            type="submit"
            disabled={!code.trim() || loading}
            className="w-full font-display text-xs font-bold tracking-[0.25em] uppercase py-4 transition-colors duration-150 disabled:opacity-20"
            style={{ background: "#FF5F1F", color: "#000" }}
          >
            {loading ? "..." : "ACCESS"}
          </button>
        </form>
      </div>
    </div>
  );
}
