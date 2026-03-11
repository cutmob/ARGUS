"use client";

import { useEffect, useRef, useCallback } from "react";

interface UseWakeWordOptions {
  onWake: () => void;
  word?: string;
  enabled?: boolean;
}

/**
 * Always-on wake word detector using the browser's built-in SpeechRecognition API.
 * Listens continuously in the background. When the wake word is heard in interim
 * or final results, fires onWake(). Auto-restarts on end/error to stay persistent.
 */
export function useWakeWord({
  onWake,
  word = "argus",
  enabled = true,
}: UseWakeWordOptions) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onWakeRef = useRef(onWake);
  const enabledRef = useRef(enabled);

  // Keep refs current so callbacks never go stale
  onWakeRef.current = onWake;
  enabledRef.current = enabled;

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;

    stop();

    const recognition: SpeechRecognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true; // catch word mid-sentence for low latency
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    let fired = false; // debounce — fire once per utterance
    let wakeTimer: ReturnType<typeof setTimeout> | null = null;
    const target = word.toLowerCase();
    // These words following the wake word indicate a command — don't activate,
    // let the voice-command handler deal with it instead.
    const STOP_WORDS = ["stop", "end", "cancel", "abort", "halt"];

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase();
        const isFinal    = event.results[i].isFinal;

        if (!fired && transcript.includes(target)) {
          // Wait briefly for the final result so we can check for stop words
          if (wakeTimer) clearTimeout(wakeTimer);
          wakeTimer = setTimeout(() => {
            if (!fired && !STOP_WORDS.some((w) => transcript.includes(w))) {
              fired = true;
              onWakeRef.current();
            }
            wakeTimer = null;
          }, isFinal ? 0 : 600);
        }

        if (isFinal) {
          fired = false;
          if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
        }
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      // Auto-restart to keep always-on behaviour
      if (enabledRef.current) start();
    };

    recognition.onerror = (e) => {
      // "no-speech" and "aborted" are expected — just restart
      if (e.error === "not-allowed" || e.error === "service-not-allowed") return;
      recognitionRef.current = null;
      if (enabledRef.current) start();
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [stop, word]);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return stop;
  }, [enabled, start, stop]);
}
