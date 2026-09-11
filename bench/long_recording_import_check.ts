/**
 * Writes FCP7 XML for the owner's own long-recording.mp4, so a real Premiere import can confirm the export.
 * Not product code. The Recording is read with the product's probeRecording, and the result is checked against what
 * Premiere wrote for this very file in fixtures/premiere/multitrack-6audio-60fps.xml before anything is written.
 *
 * Usage (from the repository root): node bench/long_recording_import_check.ts "D:\path\to\long-recording.mp4"
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CutPlan } from "../src/cutting/planCuts.ts";
import { exportFcp7Xml } from "../src/export/exportFcp7Xml.ts";
import { probeRecording } from "../src/probe/probeRecording.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ffprobe = resolve(repoRoot, "vendor", "ffprobe.exe");
const outDir = resolve(repoRoot, "bench", "out");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const recordingPath = process.argv[2];
if (!recordingPath) fail('Pfad zu long-recording.mp4 fehlt. Aufruf: node bench/long_recording_import_check.ts "D:\\...\\long-recording.mp4"');
if (!existsSync(recordingPath)) fail(`Datei nicht gefunden: ${recordingPath}`);
if (!existsSync(ffprobe)) fail(`ffprobe fehlt: ${ffprobe}`);

// What Premiere wrote for long-recording.mp4 in fixtures/premiere/multitrack-6audio-60fps.xml, one line per value.
const describeSourceTrack = (channels: number, sampleRate: number, bitDepth: number, frames: number) =>
  `${channels} Kanäle, ${sampleRate} Hz, ${bitDepth} Bit, ${frames} Frames`;
const expected = [
  "Framerate 60/1",
  "Video 1920x1080, 546692 Frames",
  ...[546692, 546690, 546690, 546690, 546690, 546690].map(
    (frames, index) => `SourceTrack ${index + 1}: ${describeSourceTrack(2, 48000, 16, frames)}`,
  ),
];

const recording = await probeRecording(recordingPath, ffprobe);
const probed = [
  `Framerate ${recording.frameRate.numerator}/${recording.frameRate.denominator}`,
  `Video ${recording.width}x${recording.height}, ${recording.durationFrames} Frames`,
  ...recording.sourceTracks.map(
    (sourceTrack, index) =>
      `SourceTrack ${index + 1}: ${describeSourceTrack(sourceTrack.channelCount, sourceTrack.sampleRate, sourceTrack.bitDepth, sourceTrack.durationFrames)}`,
  ),
];

const problems = Array.from({ length: Math.max(expected.length, probed.length) }, (_, index) => index)
  .filter((index) => expected[index] !== probed[index])
  .map((index) => `gelesen: ${probed[index] ?? "nichts"} | Premiere: ${expected[index] ?? "nichts"}`);
if (problems.length > 0) {
  fail(
    `long-recording.mp4 liest sich anders, als Premiere sie gelesen hat (falsche Datei oder Fehler im Probe-Modul). Nichts geschrieben.\n  - ${problems.join("\n  - ")}`,
  );
}
console.log("long-recording.mp4 liest sich genau so, wie Premiere sie gelesen hat.");

// Premiere's own split of the long Recording, taken from the fixture. Imported, it should look exactly like the owner's sequence.
const fixtureSplit: CutPlan = [
  { recordingIn: 0, recordingOut: 61896, timelineStart: 0, timelineEnd: 61896 },
  { recordingIn: 61896, recordingOut: 546692, timelineStart: 61896, timelineEnd: 546692 },
];

// A made-up cut with removals at known places — not an analysis result. Keeps Recording minutes 0, 5 and 10
// and the last minute, where five of the six SourceTracks end two frames before the video.
const demoCut: CutPlan = [
  { recordingIn: 0, recordingOut: 3600, timelineStart: 0, timelineEnd: 3600 },
  { recordingIn: 18000, recordingOut: 21600, timelineStart: 3600, timelineEnd: 7200 },
  { recordingIn: 36000, recordingOut: 39600, timelineStart: 7200, timelineEnd: 10800 },
  { recordingIn: 543092, recordingOut: 546692, timelineStart: 10800, timelineEnd: 14400 },
];

mkdirSync(outDir, { recursive: true });
const outputs: [string, CutPlan][] = [
  ["long-recording-fixture-split.xml", fixtureSplit],
  ["long-recording-demo-cut.xml", demoCut],
];
for (const [fileName, cutPlan] of outputs) {
  const target = resolve(outDir, fileName);
  writeFileSync(target, exportFcp7Xml(recording, cutPlan), "utf8");
  console.log(`geschrieben: ${target}`);
}
