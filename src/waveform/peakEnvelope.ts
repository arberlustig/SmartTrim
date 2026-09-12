import type { MonoPcm } from "../speech/detectSpeech.ts";

/** Int16's full scale. Dividing by 32768 makes the quietest possible sample 0 and the loudest almost exactly 1. */
const FULL_SCALE = 32768;

/**
 * Turns decoded audio into one height per small slice of time — what the window draws the waveform from. Each
 * value is the loudest sample in its slice, 0 to 1, so a short bang keeps its full height instead of being
 * averaged away.
 */
export function peakEnvelope(pcm: MonoPcm, peaksPerSecond: number): Float32Array {
  // An empty waveform would be drawn as a flat line, which reads as a Recording nobody ever made a sound on.
  if (!(peaksPerSecond > 0)) throw new Error(`${peaksPerSecond} peaks per second draws no waveform.`);
  const samplesPerPeak = pcm.sampleRate / peaksPerSecond;
  const peaks = new Float32Array(Math.ceil(pcm.samples.length / samplesPerPeak));

  for (let peak = 0; peak < peaks.length; peak += 1) {
    const from = Math.round(peak * samplesPerPeak);
    const to = Math.min(Math.round((peak + 1) * samplesPerPeak), pcm.samples.length);
    let loudest = 0;
    for (let at = from; at < to; at += 1) {
      const height = Math.abs(pcm.samples[at] as number);
      if (height > loudest) loudest = height;
    }
    peaks[peak] = loudest / FULL_SCALE;
  }
  return peaks;
}
