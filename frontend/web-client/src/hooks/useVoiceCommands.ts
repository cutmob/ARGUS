"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { stopSpeaking } from "@/lib/tts";

interface UseVoiceCommandsOptions {
  onCommand: (transcript: string) => void;
  enabled?: boolean;
}

interface UseVoiceCommandsReturn {
  listening: boolean;
  supported: boolean;
  start: () => void;
  stop: () => void;
}

export function useVoiceCommands({
  onCommand,
  enabled = false,
}: UseVoiceCommandsOptions): UseVoiceCommandsReturn {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const enabledRef = useRef(enabled);
  const [listening, setListening] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported || recognitionRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const recognition: SpeechRecognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        stopSpeaking();
        onCommand(last[0].transcript.trim().toLowerCase());
      }
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (enabledRef.current) {
        setTimeout(() => start(), 250);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setListening(false);
      recognitionRef.current = null;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") return;
      if (enabledRef.current) {
        setTimeout(() => start(), 500);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, [supported, onCommand]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return stop;
  }, [enabled, start, stop]);

  return { listening, supported, start, stop };
}
