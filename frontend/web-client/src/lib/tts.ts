/**
 * Audio playback module modelled after Google's Live API AudioStreamer.
 *
 * Design principles (from Google's best-practices):
 *  - Play PCM chunks as they arrive with a small lookahead (~200ms).
 *  - On interruption (`stopSpeaking`), immediately clear the buffer and
 *    fade out the gain node — do NOT add custom interruption logic.
 *  - Browser SpeechSynthesis is only used as a fallback for non-audio
 *    (text-only) responses; it is never mixed with PCM playback.
 */

const INPUT_SAMPLE_RATE = 24000; // Gemini outputs 24kHz PCM
const SCHEDULE_AHEAD_S = 0.2;   // 200ms lookahead like Google's reference
const FADE_OUT_S = 0.1;         // 100ms fade on stop

let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;

// PCM streaming state
let audioQueue: Float32Array[] = [];
let scheduledTime = 0;
let isPlaying = false;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let onStreamEnd: (() => void) | null = null;

// Browser TTS state (text-only fallback)
let ttsAborted = false;

// ─── AudioContext ────────────────────────────────────────────────────────────

/** Ensure the shared playback AudioContext exists and is running.
 *  Call from a user-gesture handler to unlock audio on mobile browsers. */
export function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioContext) {
    // Use browser's native sample rate — avoids "audio device error" on
    // devices that don't support 24kHz. We resample PCM in decodePCM16.
    audioContext = new AudioCtx();
  }
  if (!gainNode) {
    gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {});
  }
  return audioContext;
}

// ─── Resampling ──────────────────────────────────────────────────────────────

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const outLen = Math.round(input.length / ratio);
  const output = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    output[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return output;
}

// ─── PCM scheduling (Google AudioStreamer pattern) ────────────────────────────

function scheduleBuffers() {
  const ctx = audioContext;
  if (!ctx || !gainNode) return;

  const now = ctx.currentTime;
  if (scheduledTime < now) scheduledTime = now;

  const outRate = ctx.sampleRate;

  // Fill the lookahead window with queued buffers
  while (audioQueue.length > 0 && scheduledTime - now < SCHEDULE_AHEAD_S) {
    const samples = audioQueue.shift()!;
    // Resample from 24kHz to the context's native rate if needed
    const resampled = outRate === INPUT_SAMPLE_RATE ? samples : resampleLinear(samples, INPUT_SAMPLE_RATE, outRate);
    const buffer = ctx.createBuffer(1, resampled.length, outRate);
    buffer.copyToChannel(new Float32Array(resampled), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    source.start(scheduledTime);
    scheduledTime += buffer.duration;
  }

  // If there are still buffers queued, schedule another check
  if (audioQueue.length > 0) {
    const delay = Math.max(0, (scheduledTime - now - SCHEDULE_AHEAD_S) * 1000);
    scheduleTimer = setTimeout(scheduleBuffers, delay);
  } else if (isPlaying) {
    // Queue drained — poll briefly in case more chunks arrive
    scheduleTimer = setTimeout(() => {
      if (audioQueue.length > 0) {
        scheduleBuffers();
      } else {
        // Stream truly finished — fire onEnd after last buffer plays out
        const remaining = Math.max(0, (scheduledTime - (audioContext?.currentTime ?? 0)) * 1000);
        setTimeout(() => {
          isPlaying = false;
          onStreamEnd?.();
          onStreamEnd = null;
        }, remaining);
      }
    }, 100);
  }
}

function decodePCM16(base64: string): Float32Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Queue a base64-encoded PCM16 chunk for immediate playback. */
export function playAudioResponse(base64Audio: string, onEnd?: () => void): void {
  if (typeof window === "undefined") { onEnd?.(); return; }
  const encoded = base64Audio.trim();
  if (!encoded) { onEnd?.(); return; }

  const ctx = ensureAudioContext();
  if (!ctx) { onEnd?.(); return; }

  // Ensure gain is up (may have been faded by a previous stop)
  gainNode!.gain.cancelScheduledValues(ctx.currentTime);
  gainNode!.gain.setValueAtTime(1, ctx.currentTime);

  const samples = decodePCM16(encoded);
  audioQueue.push(samples);

  if (onEnd) onStreamEnd = onEnd;

  if (!isPlaying) {
    isPlaying = true;
    scheduledTime = ctx.currentTime;
    scheduleBuffers();
  }
}

/** Speak text via browser SpeechSynthesis (fallback for non-audio responses). */
export function speakResponse(text: string, onEnd?: () => void): void {
  const trimmed = text.trim();
  if (!trimmed || typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }
  ttsAborted = false;
  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.rate = 1.08;
  utterance.pitch = 0.92;
  utterance.onend = () => { if (!ttsAborted) onEnd?.(); };
  utterance.onerror = () => { if (!ttsAborted) onEnd?.(); };
  window.speechSynthesis.speak(utterance);
}

/** Immediately stop all audio — both PCM and TTS.
 *  This is the ONLY interruption handler. Gemini tells us when to call it. */
export function stopSpeaking(): void {
  // 1. Clear PCM queue and fade out gain node
  audioQueue = [];
  isPlaying = false;
  onStreamEnd = null;
  if (scheduleTimer) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }
  if (gainNode && audioContext) {
    gainNode.gain.cancelScheduledValues(audioContext.currentTime);
    gainNode.gain.setValueAtTime(gainNode.gain.value, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + FADE_OUT_S);
    // Recreate gain node so old scheduled sources disconnect cleanly
    setTimeout(() => {
      if (!gainNode || !audioContext) return;
      gainNode.disconnect();
      gainNode = audioContext.createGain();
      gainNode.connect(audioContext.destination);
    }, FADE_OUT_S * 1000 + 50);
  }

  // 2. Cancel browser TTS
  ttsAborted = true;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
