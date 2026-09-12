import type { TimeRange } from "../cutting/planCuts.ts";
import { speechRanges, type MonoPcm } from "../speech/detectSpeech.ts";

// The same 512-sample chunks Silero scores on, so both detectors work on one grid.
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 512;

/**
 * Finds the stretches of 16 kHz mono PCM louder than a threshold in dBFS, the way QuietCut and auto-editor decide.
 * It cannot tell a voice from noise; the owner chose it anyway after listening to both (ADR-0003).
 */
export function detectLoudness(audio: MonoPcm, thresholdDbfs: number): TimeRange[] {
  // Chunks become seconds at 16 kHz; at another rate every range would land somewhere else.
  if (audio.sampleRate !== SAMPLE_RATE) {
    throw new Error(`Loudness detection needs ${SAMPLE_RATE} Hz audio; this audio is ${audio.sampleRate} Hz.`);
  }
  const chunkCount = Math.floor(audio.samples.length / CHUNK_SAMPLES);
  const loudEnough = new Float32Array(chunkCount);
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    let sumOfSquares = 0;
    for (let offset = 0; offset < CHUNK_SAMPLES; offset++) {
      const sample = (audio.samples[chunk * CHUNK_SAMPLES + offset] ?? 0) / 32768;
      sumOfSquares += sample * sample;
    }
    const dbfs = 20 * Math.log10(Math.max(Math.sqrt(sumOfSquares / CHUNK_SAMPLES), 1e-10));
    // Ranges are built by the rules speech follows (ADR-0010): a loud chunk scores 1, a quiet one 0.
    loudEnough[chunk] = dbfs > thresholdDbfs ? 1 : 0;
  }
  return speechRanges(loudEnough);
}
