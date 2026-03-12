"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { speakResponse } from "@/lib/tts";
import type { ActionCard, Hazard, Overlay } from "@/lib/types";

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
  report_id?: string;
  hazards?: Hazard[];
  overlays?: Overlay[];
  actions?: ActionCard[];
}

interface SessionAgentResponse {
  type: string;
  text: string;
  reportId?: string;
  at: number;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws";

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

export function useArgusSession() {
  const [connected, setConnected]       = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [hazards, setHazards]           = useState<Hazard[]>([]);
  const [overlays, setOverlays]         = useState<Overlay[]>([]);
  const [riskLevel, setRiskLevel]       = useState<string>("low");
  const [actionCards, setActionCards]   = useState<ActionCard[]>([]);
  const [sessionId, setSessionId]       = useState<string>("");
  const [processing, setProcessing]     = useState(false);
  const [speaking, setSpeaking]         = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [lastAgentResponse, setLastAgentResponse] = useState<SessionAgentResponse | null>(null);

  const wsRef          = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout>();
  const voiceOutputEnabledRef = useRef(true);
  voiceOutputEnabledRef.current = voiceOutputEnabled;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const cameraId = generateCameraId();
    const token = getDemoToken();
    const existingSessionId = typeof window !== "undefined"
      ? localStorage.getItem("argus_session_id")
      : "";
    const url = WS_URL +
      (WS_URL.includes("?") ? "&" : "?") + "camera_id=" + cameraId +
      (existingSessionId ? "&session_id=" + encodeURIComponent(existingSessionId) : "") +
      (token ? "&token=" + encodeURIComponent(token) : "");
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      setProcessing(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WebSocketMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch (err) {
        console.error("[ARGUS] Invalid message:", err);
      }
    };

    ws.onclose = (ev) => {
      setConnected(false);
      // Code 1006 with no open = server rejected before upgrade (e.g. 401)
      // Don't retry in that case — show the gate again
      if (!unauthorized && ev.code !== 1006) {
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
        setOverlays(newOverlays);
        break;
      }

      case "risk_update": {
        const data = msg.payload as { risk_level: string };
        setRiskLevel(data.risk_level);
        break;
      }

      case "voice_response": {
        const data = msg.payload as { text: string };
        if (!voiceOutputEnabledRef.current) {
          setSpeaking(false);
          break;
        }
        setSpeaking(true);
        speakResponse(data.text, () => setSpeaking(false));
        break;
      }

      case "agent_response": {
        const data = msg.payload as AgentResponsePayload;
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
          setOverlays(data.overlays);
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
            at: Date.now(),
          });
        }
        const spoken = data.voice || data.text;
        if (spoken && voiceOutputEnabledRef.current) {
          setSpeaking(true);
          speakResponse(spoken, () => setSpeaking(false));
        } else if (spoken) {
          setSpeaking(false);
        }
        break;
      }

      case "inspection_started":
        setIsInspecting(true);
        break;

      case "inspection_stopped":
        setIsInspecting(false);
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
      sendCommand("start_inspection", { mode });
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
    (mode: string) => { sendCommand("switch_mode", { mode }); },
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

  const clearHazards = useCallback(() => {
    setHazards([]);
    setOverlays([]);
    setActionCards([]);
    setRiskLevel("low");
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
    lastAgentResponse,
    sendFrame,
    startInspection,
    stopInspection,
    switchMode,
    generateReport,
    requestActions,
    sendNaturalLanguageCommand,
    clearHazards,
    setVoiceOutputEnabled,
    resetAuth,
  };
}
