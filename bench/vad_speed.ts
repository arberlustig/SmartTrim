/**
 * Measures how fast detectSpeech runs on real material. Not product code.
 * Input: raw 16 kHz mono s16le PCM, such as bench/out/trk1.raw (15 minutes of long-recording.mp4's SourceTrack 1).
 *
 * Usage (from the repository root): node bench/vad_speed.ts bench/out/trk1.raw [more.raw ...]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectSpeech } from "../src/speech/detectSpeech.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const model = resolve(repoRoot, "vendor", "silero_vad.onnx");

for (const path of process.argv.slice(2)) {
  const raw = readFileSync(path);
  const samples = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength - (raw.byteLength % 2)));
  const audioSeconds = samples.length / 16000;

  const started = performance.now();
  const ranges = await detectSpeech({ sampleRate: 16000, samples }, model);
  const elapsedSeconds = (performance.now() - started) / 1000;

  const speechSeconds = ranges.reduce((total, range) => total + range.endSeconds - range.startSeconds, 0);
  console.log(
    `${path}: ${(audioSeconds / 60).toFixed(1)} min Ton in ${elapsedSeconds.toFixed(1)} s ` +
      `(${(audioSeconds / elapsedSeconds).toFixed(0)}x Echtzeit), ${ranges.length} Sprechstellen, ` +
      `${((100 * speechSeconds) / audioSeconds).toFixed(1)} % Sprache`,
  );
}
