/**
 * ARGUS Audio Worklet Processor
 *
 * Runs in the AudioWorklet thread for lowest-latency mic capture.
 * Emits ~20ms PCM16 chunks at 16kHz to the main thread, aligned with
 * Google Gemini Live API best-practice chunk sizing (20-40ms).
 *
 * NO client-side VAD — Gemini handles voice activity detection server-side.
 * Sending all audio ensures the model hears the operator reliably.
 */

const TARGET_SAMPLE_RATE = 16000;
// 320 samples at 16kHz = exactly 20ms per chunk
const OUTPUT_CHUNK_SAMPLES = 320;

class ArgusAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(OUTPUT_CHUNK_SAMPLES * 4);
    this._bufferLen = 0;
    this._ratio = null;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const raw = input[0]; // Float32, browser sample rate, mono

    // Compute downsampling ratio on first frame
    if (this._ratio === null) {
      this._ratio = sampleRate / TARGET_SAMPLE_RATE;
    }

    // Downsample to 16kHz using averaging
    const ratio = this._ratio;
    const outputLen = Math.round(raw.length / ratio);

    for (let out = 0; out < outputLen; out++) {
      const start = Math.round(out * ratio);
      const end = Math.min(raw.length, Math.round((out + 1) * ratio));
      let acc = 0;
      let count = 0;
      for (let i = start; i < end; i++) {
        acc += raw[i];
        count++;
      }
      const sample = Math.max(-1, Math.min(1, count > 0 ? acc / count : 0));

      if (this._bufferLen >= this._buffer.length) {
        const bigger = new Float32Array(this._buffer.length * 2);
        bigger.set(this._buffer);
        this._buffer = bigger;
      }
      this._buffer[this._bufferLen++] = sample;

      // Emit chunk when we have OUTPUT_CHUNK_SAMPLES accumulated
      if (this._bufferLen >= OUTPUT_CHUNK_SAMPLES) {
        const pcm16 = floatToPCM16(this._buffer.subarray(0, OUTPUT_CHUNK_SAMPLES));
        this.port.postMessage({ pcm16 }, [pcm16.buffer]);
        const remaining = this._bufferLen - OUTPUT_CHUNK_SAMPLES;
        this._buffer.copyWithin(0, OUTPUT_CHUNK_SAMPLES, this._bufferLen);
        this._bufferLen = remaining;
      }
    }

    return true;
  }
}

function floatToPCM16(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return pcm;
}

registerProcessor("argus-audio-processor", ArgusAudioProcessor);
