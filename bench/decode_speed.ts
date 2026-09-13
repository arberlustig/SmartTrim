/**
 * Measures decodeSourceTracks on a real Recording: how long decoding SourceTracks to 16 kHz mono PCM takes and how
 * much memory it needs. Not product code.
 *
 * Usage (from the repository root): node bench/decode_speed.ts "C:\path\to\recording.mp4" [SourceTrack numbers]
 * Without numbers, every SourceTrack is decoded.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSourceTracks } from "../src/decode/decodeSourceTracks.ts";
import { probeRecording } from "../src/probe/probeRecording.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = (name: string) => resolve(repoRoot, "vendor", name);

const [recordingPath, ...sourceTrackNumbers] = process.argv.slice(2);
if (!recordingPath) {
  console.error('Aufruf: node bench/decode_speed.ts "C:\\...\\aufnahme.mp4" [Spurnummern]');
  process.exit(1);
}

const recording = await probeRecording(recordingPath, vendor("ffprobe.exe"));
const indexes =
  sourceTrackNumbers.length > 0
    ? sourceTrackNumbers.map((number) => Number(number) - 1)
    : recording.sourceTracks.map((_, index) => index);
const recordingSeconds = (recording.durationFrames * recording.frameRate.denominator) / recording.frameRate.numerator;

const started = performance.now();
const decoded = await decodeSourceTracks(recording, indexes, vendor("ffmpeg.exe"), (_index, pcm) => pcm);
const elapsedSeconds = (performance.now() - started) / 1000;

decoded.forEach((pcm, position) => {
  console.log(
    `SourceTrack ${(indexes[position] ?? NaN) + 1}: ${(pcm.samples.length / pcm.sampleRate).toFixed(3)} s dekodiert ` +
      `(Video ${recordingSeconds.toFixed(3)} s), ${(pcm.samples.byteLength / 1024 ** 2).toFixed(0)} MB`,
  );
});
console.log(
  `${decoded.length} SourceTracks in ${elapsedSeconds.toFixed(1)} s, ` +
    `Speicher-Spitze dieses Prozesses ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`,
);
