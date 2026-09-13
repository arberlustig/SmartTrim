/**
 * Measures what SmartTrim keeps of a Recording's SourceTracks once they are read (ADR-0021): the chunk levels and
 * the waveform, against the decoded audio they came from and which was kept until then. Not product code.
 *
 * The read happens inside a function, as it does inside the product's IPC handler. Done in top-level module code
 * instead, the decoded audio can stay reachable from the module's own suspended state after its block has ended,
 * and the measurement would report the bench holding on to it rather than the product.
 *
 * Usage (from the repository root): node --expose-gc bench/kept_memory.ts "C:\path\to\recording.mp4" [numbers]
 * Without numbers, every SourceTrack is read.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSourceTrackFrom } from "../src/analysis/analyseRecording.ts";
import { decodeSourceTracks } from "../src/decode/decodeSourceTracks.ts";
import { probeRecording } from "../src/probe/probeRecording.ts";
import type { RecordingInfo } from "../src/export/exportFcp7Xml.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = (name: string) => resolve(repoRoot, "vendor", name);
const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const gc = (globalThis as { gc?: () => void }).gc;

/** Collects a few times with pauses between: array buffer memory is released behind the collector, not inside it. */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    gc?.();
    await new Promise((done) => setTimeout(done, 400));
  }
}

/** The product's read, reduced to what it keeps. The decoded audio is unreachable once this returns. */
async function readAndKeep(recording: RecordingInfo, positions: readonly number[]) {
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 50);
  const started = performance.now();
  let audioBytes = 0;
  const kept = await decodeSourceTracks(recording, positions, vendor("ffmpeg.exe"), (position, pcm) => {
    audioBytes += pcm.samples.byteLength;
    return readSourceTrackFrom(position, pcm);
  });
  clearInterval(sampler);
  return { kept, audioBytes, peakRss, seconds: (performance.now() - started) / 1000 };
}

const [recordingPath, ...sourceTrackNumbers] = process.argv.slice(2);
if (!recordingPath) {
  console.error('Aufruf: node --expose-gc bench/kept_memory.ts "C:\\...\\aufnahme.mp4" [Spurnummern]');
  process.exit(1);
}
if (!gc) console.warn("Ohne --expose-gc sind die Zahlen nach dem Aufräumen nur grob.");

const recording = await probeRecording(recordingPath, vendor("ffprobe.exe"));
const positions =
  sourceTrackNumbers.length > 0
    ? sourceTrackNumbers.map((number) => Number(number) - 1)
    : recording.sourceTracks.map((_sourceTrack, index) => index);

await settle();
const before = process.memoryUsage();
const { kept, audioBytes, peakRss, seconds } = await readAndKeep(recording, positions);
await settle();
const after = process.memoryUsage();

const keptBytes = kept.reduce((total, read) => total + read.levelsDbfs.byteLength + read.peaks.byteLength, 0);
console.log(`${kept.length} SourceTracks in ${seconds.toFixed(1)} s gelesen`);
console.log(`Ton, der bisher die ganze Sitzung behalten wurde: ${megabytes(audioBytes)}`);
console.log(`Jetzt behalten (Lautstärke-Werte + Wellenform): ${megabytes(keptBytes)}`);
console.log(`Spitze des Prozesses beim Einlesen: ${megabytes(peakRss)}`);
console.log(
  `Nach dem Aufräumen: Heap ${megabytes(after.heapUsed)}, Puffer ${megabytes(after.arrayBuffers)}, ` +
    `Prozess ${megabytes(after.rss)} (vorher Heap ${megabytes(before.heapUsed)}, Puffer ${megabytes(before.arrayBuffers)})`,
);
