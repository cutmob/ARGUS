"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ensureAudioContext, playAudioResponse, speakResponse, stopSpeaking } from "@/lib/tts";
import type { ActionCard, AlertThreshold, Hazard, Incident, Overlay, Severity } from "@/lib/types";

interface WebSocketMessage {
  type: string;
  session_id: string;
  payload: unknown;
  timestamp: string;
}

interface AgentResponsePayload {
  type: string;
  text?: string;
  voice?: string;
  audio_data?: string;
  speaker?: string;
  report_id?: string;
  download_url?: string;
  hazards?: Hazard[];
  overlays?: Overlay[];
  actions?: ActionCard[];
}

interface SessionAgentResponse {
  type: string;
  text: string;
  reportId?: string;
  downloadUrl?: string;
  at: number;
}

interface SessionTranscript {
  speaker: string;
  text: string;
  at: number;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";
const IS_PRODUCTION = typeof window !== "undefined" && window.location.protocol === "https:";

function getWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env) return env;
  // In production (HTTPS), auto-derive wss:// from current host
  if (IS_PRODUCTION) {
    return `wss://${window.location.host}/ws`;
  }
  return WS_URL;
}
const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// Overlay visible duration (before fade-out starts) scales by max severity.
const OVERLAY_DURATION: Record<Severity, number> = {
  low:      3000,
  medium:   3100,
  high:     3300,
  critical: 3500,
};
// How long the CSS fade-out animation lasts (must match .overlay-exit in globals.css)
const OVERLAY_FADE_OUT_MS = 400;
const ALERT_THRESHOLD_RANK: Record<AlertThreshold, number> = {
  off: Number.POSITIVE_INFINITY,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function shouldSpeakFinding(hazards: Hazard[], threshold: AlertThreshold): boolean {
  if (threshold === "off") return false;
  return hazards.some((hazard) => SEVERITY_RANK[hazard.severity] >= ALERT_THRESHOLD_RANK[threshold]);
}

function getDemoToken(): string {
  return typeof window !== "undefined"
    ? (localStorage.getItem("argus_demo_token") ?? "")
    : "";
}

function generateCameraId(): string {
  // Stable per-device ID persisted in localStorage
  const key = "argus_camera_id";
  let id = typeof window !== "undefined" ? localStorage.getItem(key) : null;
  if (!id) {
    id = "cam_" + Math.random().toString(36).slice(2, 10);
    if (typeof window !== "undefined") localStorage.setItem(key, id);
  }
  return id;
}

/** Resolve a relative backend path (e.g. /api/v1/reports/files/foo.pdf)
 *  into a full URL pointing at the backend, not the frontend dev server. */
function resolveBackendUrl(path: string): string {
  if (!path) return path;
  if (path.startsWith("http")) return path;
  const wsUrl = getWsUrl();
  // Convert ws(s)://host/ws → http(s)://host
  const httpBase = wsUrl
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/ws$/, "");
  return httpBase + path;
}

export function useArgusSession() {
  const [connected, setConnected]       = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [hazards, setHazards]           = useState<Hazard[]>([]);
  const [overlays, setOverlays]         = useState<Overlay[]>([]);
  const [overlaysFading, setOverlaysFading] = useState(false);
  const [riskLevel, setRiskLevel]       = useState<string>("low");
  const [actionCards, setActionCards]   = useState<ActionCard[]>([]);
  const [sessionId, setSessionId]       = useState<string>("");
  const [processing, setProcessing]     = useState(false);
  const [speaking, setSpeaking]         = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [alertThreshold, setAlertThresholdState] = useState<AlertThreshold>("high");
  const [lastAgentResponse, setLastAgentResponse] = useState<SessionAgentResponse | null>(null);
  const [lastTranscript, setLastTranscript] = useState<SessionTranscript | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const wsRef          = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout>();
  const overlayFadeTimer = useRef<NodeJS.Timeout>();
  const overlayDismissTimer = useRef<NodeJS.Timeout>();
  const voiceOutputEnabledRef = useRef(true);
  const alertThresholdRef = useRef<AlertThreshold>("high");
  const isInspectingRef = useRef(false);
  const lastSpokenRef = useRef<{ text: string; at: number } | null>(null);
  voiceOutputEnabledRef.current = voiceOutputEnabled;
  alertThresholdRef.current = alertThreshold;
  isInspectingRef.current = isInspecting;

  const speakIfAllowed = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !voiceOutputEnabledRef.current) {
      setSpeaking(false);
      return;
    }
    const normalized = trimmed.toLowerCase();
    const lastSpoken = lastSpokenRef.current;
    if (lastSpoken && lastSpoken.text === normalized && Date.now() - lastSpoken.at < 6000) {
      setSpeaking(false);
      return;
    }
    lastSpokenRef.current = { text: normalized, at: Date.now() };
    setSpeaking(true);
    speakResponse(trimmed, () => setSpeaking(false));
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const cameraId = generateCameraId();
    const token = getDemoToken();
    const existingSessionId = typeof window !== "undefined"
      ? localStorage.getItem("argus_session_id")
      : "";
    const baseUrl = getWsUrl();
    const url = baseUrl +
      (baseUrl.includes("?") ? "&" : "?") + "camera_id=" + cameraId +
      (existingSessionId ? "&session_id=" + encodeURIComponent(existingSessionId) : "");
    const ws = new WebSocket(url);

    ws.onopen = () => {
      // Send auth token as first frame instead of URL query parameter
      if (token) {
        ws.send(JSON.stringify({ type: "auth", token }));
      }
      setConnected(true);
      setProcessing(false);
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data);
        if (!parsed || typeof parsed.type !== "string") return;
        const msg: WebSocketMessage = {
          type: parsed.type,
          session_id: typeof parsed.session_id === "string" ? parsed.session_id : "",
          payload: parsed.payload ?? null,
          timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
        };
        handleMessage(msg);
      } catch (err) {
        console.error("[ARGUS] Invalid message:", err);
      }
    };

    ws.onclose = (ev) => {
      setConnected(false);
      // 1008 = policy violation (auth failure), 1006 = abnormal before upgrade
      if (ev.code === 1008 || ev.code === 1006) {
        setUnauthorized(true);
        localStorage.removeItem("argus_demo_token");
        return;
      }
      if (!unauthorized) {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      // If we never opened, treat as auth failure so the gate re-appears
      if (ws.readyState !== WebSocket.OPEN) {
        setUnauthorized(true);
        localStorage.removeItem("argus_demo_token");
      }
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  const setOverlaysWithAutoDismiss = useCallback((newOverlays: Overlay[]) => {
    clearTimeout(overlayFadeTimer.current);
    clearTimeout(overlayDismissTimer.current);
    setOverlays(newOverlays);
    setOverlaysFading(false);
    if (newOverlays.length > 0) {
      // Pick the longest duration based on the highest severity in the batch
      const maxSev = newOverlays.reduce<Severity>((acc, o) => {
        const s = o.severity as Severity;
        return (SEVERITY_RANK[s] ?? 0) > (SEVERITY_RANK[acc] ?? 0) ? s : acc;
      }, "low");
      const visibleMs = OVERLAY_DURATION[maxSev] ?? 3000;
      // After the visible period, start the CSS fade-out
      overlayFadeTimer.current = setTimeout(() => {
        setOverlaysFading(true);
        // After fade-out animation completes, remove overlays from DOM
        overlayDismissTimer.current = setTimeout(() => {
          setOverlays([]);
          setOverlaysFading(false);
        }, OVERLAY_FADE_OUT_MS);
      }, visibleMs);
    }
  }, []);

  const handleMessage = useCallback((msg: WebSocketMessage) => {
    setProcessing(false);

    switch (msg.type) {
      case "session_created":
        setSessionId(msg.session_id);
        localStorage.setItem("argus_session_id", msg.session_id);
        break;

      case "hazard_detected": {
        const hazard = msg.payload as Hazard;
        setHazards((prev) => [hazard, ...prev]);
        break;
      }

      case "overlays_update": {
        const newOverlays = msg.payload as Overlay[];
        setOverlaysWithAutoDismiss(newOverlays);
        break;
      }

      case "risk_update": {
        const data = msg.payload as { risk_level: string };
        setRiskLevel(data.risk_level);
        break;
      }

      case "voice_response": {
        // Only use browser TTS when Gemini Live is NOT active
        if (!isInspectingRef.current) {
          const data = msg.payload as { text: string };
          speakIfAllowed(data.text);
        }
        break;
      }

      case "agent_response": {
        const data = msg.payload as AgentResponsePayload;
        // Gemini interruption: user spoke during model output — clear audio queue
        if (data.type === "interrupted") {
          stopSpeaking();
          setSpeaking(false);
          break;
        }
        // Gemini session error — log it but do NOT reset isInspecting.
        // The backend handles Gemini reconnection automatically; resetting
        // the flag here causes the Start button to flicker.
        if (data.type === "session_error") {
          console.warn("[ARGUS] Gemini session error:", data.text);
          stopSpeaking();
          setSpeaking(false);
          break;
        }
        if (data.type === "transcript" && data.text) {
          setLastTranscript({
            speaker: data.speaker || "model",
            text: data.text,
            at: Date.now(),
          });
          break;
        }
        const hazardPayload = Array.isArray(data.hazards) ? data.hazards : [];
        if (Array.isArray(data.hazards) && data.hazards.length > 0) {
          setHazards((prev) => {
            const next = [...prev];
            for (const h of data.hazards ?? []) {
              const idx = next.findIndex((x) => x.id === h.id);
              if (idx >= 0) next[idx] = h;
              else next.unshift(h);
            }
            return next;
          });
        }
        if (Array.isArray(data.overlays)) {
          setOverlaysWithAutoDismiss(data.overlays);
        }
        if (Array.isArray(data.actions)) {
          setActionCards(data.actions);
        }
        const text = (data.text || data.voice || "").trim();
        if (text || data.type === "report" || data.report_id) {
          setLastAgentResponse({
            type: data.type || "voice",
            text,
            reportId: data.report_id,
            downloadUrl: data.download_url ? resolveBackendUrl(data.download_url) : undefined,
            at: Date.now(),
          });
        }
        // Only trigger browser TTS for explicit voice responses.
        // text-only payloads are display-only — native audio comes via audio_data.
        const spoken = data.voice;
        const audioData = typeof data.audio_data === "string" ? data.audio_data.trim() : "";
        const findingsAllowed =
          hazardPayload.length === 0 || shouldSpeakFinding(hazardPayload, alertThresholdRef.current);
        if (audioData && voiceOutputEnabledRef.current && findingsAllowed) {
          setSpeaking(true);
          playAudioResponse(audioData, () => setSpeaking(false));
        } else if (spoken && voiceOutputEnabledRef.current && findingsAllowed && !isInspectingRef.current) {
          // Browser TTS fallback — only when Gemini Live is NOT active
          speakIfAllowed(spoken);
        } else if (spoken || audioData) {
          stopSpeaking();
          setSpeaking(false);
        }
        break;
      }

      case "incidents_update": {
        const incoming = msg.payload as Incident[];
        if (Array.isArray(incoming)) {
          setIncidents(incoming);
        }
        break;
      }

      case "inspection_started":
        setIsInspecting(true);
        break;

      case "inspection_stopped":
        setIsInspecting(false);
        setIncidents([]);
        break;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendFrame = useCallback((blob: Blob) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    blob.arrayBuffer().then((buffer) => {
      const typeByte  = new Uint8Array([0x01]);
      const frameData = new Uint8Array(buffer);
      const message   = new Uint8Array(typeByte.length + frameData.length);
      message.set(typeByte, 0);
      message.set(frameData, 1);
      wsRef.current?.send(message.buffer);
    });
  }, []);

  const sendAudio = useCallback((chunk: Uint8Array) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || chunk.byteLength === 0) return;
    const typeByte = new Uint8Array([0x02]);
    const message = new Uint8Array(typeByte.length + chunk.length);
    message.set(typeByte, 0);
    message.set(chunk, 1);
    wsRef.current.send(message.buffer);
  }, []);

  /** Signal that the audio stream has ended (mic muted). Gemini flushes buffered audio. */
  const sendAudioStreamEnd = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const signal = new Uint8Array([0x03]);
    wsRef.current.send(signal.buffer);
  }, []);

  const sendCommand = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const msg = {
        type,
        session_id: sessionId,
        payload,
        timestamp: new Date().toISOString(),
      };
      wsRef.current.send(JSON.stringify(msg));
      setProcessing(true);
    },
    [sessionId]
  );

  const startInspection = useCallback(
    (mode: string) => {
      // Resume the shared TTS AudioContext on this user gesture — browsers
      // block audio playback until a user interaction unlocks it.
      ensureAudioContext();
      sendCommand("start_inspection", {
        mode,
        camera_id: generateCameraId(),
        alert_threshold: alertThresholdRef.current,
      });
      setIsInspecting(true);
      setHazards([]);
      setOverlays([]);
      setActionCards([]);
    },
    [sendCommand]
  );

  const stopInspection = useCallback(() => {
    sendCommand("stop_inspection");
    setIsInspecting(false);
  }, [sendCommand]);

  const switchMode = useCallback(
    (mode: string) => {
      sendCommand("switch_mode", { mode });
      setHazards([]);
      setOverlays([]);
      setActionCards([]);
      setIncidents([]);
    },
    [sendCommand]
  );

  const generateReport = useCallback((format = "json") => {
    sendCommand("generate_report", { format });
  }, [sendCommand]);

  const requestActions = useCallback(() => {
    sendCommand("operator_actions", { limit: 3 });
  }, [sendCommand]);

  const sendNaturalLanguageCommand = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      sendCommand("voice_command", { text: trimmed });
    },
    [sendCommand]
  );

  const updatePreferences = useCallback(
    (payload: Record<string, unknown>) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({
        type: "update_preferences",
        session_id: sessionId,
        payload,
        timestamp: new Date().toISOString(),
      }));
    },
    [sessionId]
  );

  const setAlertThreshold = useCallback(
    (threshold: AlertThreshold) => {
      setAlertThresholdState(threshold);
      updatePreferences({ alert_threshold: threshold });
    },
    [updatePreferences]
  );

  const clearHazards = useCallback(() => {
    setHazards([]);
    setOverlays([]);
    setActionCards([]);
    setRiskLevel("low");
  }, []);

  const interruptSpeech = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
  }, []);

  const resetAuth = useCallback(() => {
    setUnauthorized(false);
    connect();
  }, [connect]);

  return {
    connected,
    unauthorized,
    isInspecting,
    hazards,
    overlays,
    actionCards,
    riskLevel,
    sessionId,
    processing,
    speaking,
    voiceOutputEnabled,
    alertThreshold,
    lastAgentResponse,
    lastTranscript,
    incidents,
    overlaysFading,
    sendFrame,
    sendAudio,
    sendAudioStreamEnd,
    startInspection,
    stopInspection,
    switchMode,
    generateReport,
    requestActions,
    sendNaturalLanguageCommand,
    clearHazards,
    interruptSpeech,
    setVoiceOutputEnabled,
    setAlertThreshold,
    updatePreferences,
    resetAuth,
  };
}
