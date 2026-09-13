import type { TimeRange } from "../cutting/planCuts.ts";
import { speechRanges, type MonoPcm } from "../speech/detectSpeech.ts";

// The same 512-sample chunks Silero scores on, so every detector works on one grid.
export const SAMPLE_RATE = 16000;
export const CHUNK_SAMPLES = 512;

/**
 * How loud each 32 ms chunk of one SourceTrack is, in dBFS — everything any later decision reads (ADR-0021). This
 * is what SmartTrim keeps for the whole session instead of the audio: 2.3 MB for a 2.5-hour SourceTrack against
 * 278 MB of samples. Full `Float64Array` precision on purpose: a level a hair from the threshold must land on the
 * same side it did when it was computed, or a kept cut would silently differ from a fresh one.
 */
export interface ChunkLevels {
  levelsDbfs: Float64Array;
}

/** The level of every whole chunk in dBFS. Digital silence lands at -200, low enough to be silence to any threshold. */
export function chunkLevelsDbfs(audio: MonoPcm): number[] {
  const chunkCount = Math.floor(audio.samples.length / CHUNK_SAMPLES);
  const levels: number[] = new Array(chunkCount);
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    let sumOfSquares = 0;
    for (let offset = 0; offset < CHUNK_SAMPLES; offset++) {
      const sample = (audio.samples[chunk * CHUNK_SAMPLES + offset] ?? 0) / 32768;
      sumOfSquares += sample * sample;
    }
    levels[chunk] = 20 * Math.log10(Math.max(Math.sqrt(sumOfSquares / CHUNK_SAMPLES), 1e-10));
  }
  return levels;
}

/**
 * Finds the stretches of 16 kHz mono PCM louder than a threshold in dBFS, the way QuietCut and auto-editor decide.
 * It cannot tell a voice from noise; the owner chose it anyway after listening to both (ADR-0003).
 */
export function detectLoudness(audio: MonoPcm, thresholdDbfs: number): TimeRange[] {
  // Chunks become seconds at 16 kHz; at another rate every range would land somewhere else.
  if (audio.sampleRate !== SAMPLE_RATE) {
    throw new Error(`Loudness detection needs ${SAMPLE_RATE} Hz audio; this audio is ${audio.sampleRate} Hz.`);
  }
  return loudRanges({ levelsDbfs: Float64Array.from(chunkLevelsDbfs(audio)) }, thresholdDbfs);
}

/**
 * The same decision made from the kept chunk levels instead of the audio. This is what a moved threshold slider
 * runs: the levels do not depend on the threshold, so the audio they came from is not needed again (ADR-0021).
 */
export function loudRanges(levels: ChunkLevels, thresholdDbfs: number): TimeRange[] {
  const loudEnough = new Float32Array(levels.levelsDbfs.length);
  // Ranges are built by the rules speech follows (ADR-0010): a loud chunk scores 1, a quiet one 0.
  for (let chunk = 0; chunk < levels.levelsDbfs.length; chunk += 1) {
    loudEnough[chunk] = (levels.levelsDbfs[chunk] as number) > thresholdDbfs ? 1 : 0;
  }
  return speechRanges(loudEnough);
}
