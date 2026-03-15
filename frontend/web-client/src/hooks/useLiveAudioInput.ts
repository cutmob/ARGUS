"use client";

import { useEffect, useRef, useState } from "react";

interface UseLiveAudioInputOptions {
  enabled: boolean;
  onChunk: (chunk: Uint8Array) => void;
  /** Called when the audio stream ends (mic muted) so the caller can signal audioStreamEnd. */
  onStreamEnd?: () => void;
}

interface UseLiveAudioInputResult {
  active: boolean;
  supported: boolean;
}

const TARGET_SAMPLE_RATE = 16000;
const FALLBACK_BUFFER_SIZE = 1024;

export function useLiveAudioInput({
  enabled,
  onChunk,
  onStreamEnd,
}: UseLiveAudioInputOptions): UseLiveAudioInputResult {
  const [active, setActive] = useState(false);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;
  const onStreamEndRef = useRef(onStreamEnd);
  onStreamEndRef.current = onStreamEnd;

  const streamRef    = useRef<MediaStream | null>(null);
  const contextRef   = useRef<AudioContext | null>(null);
  const workletRef   = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef    = useRef<MediaStreamAudioSourceNode | null>(null);
  const sinkRef      = useRef<GainNode | null>(null);

  useEffect(() => {
    if (!enabled) {
      teardown();
      return;
    }

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setActive(false);
      return;
    }

    let cancelled = false;

    function startPipeline() {
      navigator.mediaDevices
        .getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        })
        .then(async (stream) => {
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

          const AudioCtx =
            window.AudioContext ||
            (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioCtx) { stream.getTracks().forEach((t) => t.stop()); return; }

          const context = new AudioCtx();
          if (context.state === "suspended") await context.resume().catch(() => {});

          const source = context.createMediaStreamSource(stream);
          const sink = context.createGain();
          sink.gain.value = 0;
          sink.connect(context.destination);

          // --- AudioWorklet path (preferred) ---
          let usedWorklet = false;
          if (context.audioWorklet) {
            try {
              await context.audioWorklet.addModule("/argus-audio-worklet.js");
              const worklet = new AudioWorkletNode(context, "argus-audio-processor");
              worklet.port.onmessage = (ev: MessageEvent<{ pcm16: Int16Array }>) => {
                if (cancelled) return;
                onChunkRef.current(new Uint8Array(ev.data.pcm16.buffer));
              };
              // Auto-restart on worklet crash
              worklet.onprocessorerror = () => {
                if (!cancelled) restart();
              };
              source.connect(worklet);
              worklet.connect(sink);
              workletRef.current = worklet;
              usedWorklet = true;
            } catch {
              // Worklet unavailable — fall through to ScriptProcessor
            }
          }

          // --- ScriptProcessor fallback (no VAD — let Gemini handle silence) ---
          if (!usedWorklet) {
            const processor = context.createScriptProcessor(FALLBACK_BUFFER_SIZE, 1, 1);
            processor.onaudioprocess = (ev) => {
              if (cancelled) return;
              const input = ev.inputBuffer.getChannelData(0);
              const pcm16 = downsampleToPCM16(input, ev.inputBuffer.sampleRate, TARGET_SAMPLE_RATE);
              if (pcm16.byteLength > 0) onChunkRef.current(new Uint8Array(pcm16.buffer));
            };
            source.connect(processor);
            processor.connect(sink);
            processorRef.current = processor;
          }

          streamRef.current  = stream;
          contextRef.current = context;
          sourceRef.current  = source;
          sinkRef.current    = sink;
          setActive(true);
        })
        .catch(() => setActive(false));
    }

    function restart() {
      teardown();
      if (!cancelled) startPipeline();
    }

    startPipeline();

    // Watchdog: auto-resume suspended AudioContext and restart dead streams.
    const watchdog = setInterval(() => {
      const ctx = contextRef.current;
      const tracks = streamRef.current?.getAudioTracks();
      if (cancelled) return;

      // No context means pipeline hasn't started or was torn down — restart
      if (!ctx) { restart(); return; }

      // Resume suspended context
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }

      // Context closed unexpectedly — restart entire pipeline
      if (ctx.state === "closed") {
        restart();
        return;
      }

      // MediaStream track ended (browser revoked permission, device lost) — restart
      if (tracks && tracks.length > 0 && tracks[0].readyState === "ended") {
        restart();
      }
    }, 2000);

    return () => { cancelled = true; clearInterval(watchdog); teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  function teardown() {
    const wasActive = !!streamRef.current;
    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    sinkRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = sourceRef.current = workletRef.current = processorRef.current = sinkRef.current = null;
    if (contextRef.current && contextRef.current.state !== "closed") {
      void contextRef.current.close().catch(() => {});
    }
    contextRef.current = null;
    setActive(false);
    // Signal audioStreamEnd so Gemini flushes buffered audio
    if (wasActive) {
      onStreamEndRef.current?.();
    }
  }

  return {
    active,
    supported: typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
  };
}

function downsampleToPCM16(input: Float32Array, inputRate: number, outputRate: number): Int16Array {
  if (inputRate === outputRate) {
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 32768 : s * 32767;
    }
    return pcm;
  }
  const ratio = inputRate / outputRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outLen);
  let oIdx = 0, iIdx = 0;
  while (oIdx < outLen) {
    const next = Math.min(input.length, Math.round((oIdx + 1) * ratio));
    let acc = 0, count = 0;
    for (let i = iIdx; i < next; i++) { acc += input[i]; count++; }
    const s = Math.max(-1, Math.min(1, count > 0 ? acc / count : 0));
    output[oIdx++] = s < 0 ? s * 32768 : s * 32767;
    iIdx = next;
  }
  return output;
}
