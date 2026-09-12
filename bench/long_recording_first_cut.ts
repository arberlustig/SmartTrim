/**
 * The first automatic cut of the owner's long-recording.mp4, for a real Premiere import. Not product code.
 * Listens to SourceTracks 1, 5 and 6, where speech was found (ADR-0010), with provisional settings: a Margin of
 * 0.3 s and a MinimumDeadZone of 2 s, the example values of ADR-0007.
 *
 * Usage (from the repository root): node bench/long_recording_first_cut.ts "C:\path\to\long-recording.mp4"
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseRecording } from "../src/analysis/analyseRecording.ts";
import { exportFcp7Xml } from "../src/export/exportFcp7Xml.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = (name: string) => resolve(repoRoot, "vendor", name);
const outDir = resolve(repoRoot, "bench", "out");

const recordingPath = process.argv[2];
if (!recordingPath || !existsSync(recordingPath)) {
  console.error('Aufruf: node bench/long_recording_first_cut.ts "C:\\...\\long-recording.mp4"');
  process.exit(1);
}

const started = performance.now();
const { recording, cutPlan } = await analyseRecording(
  { recordingPath, voiceSourceTracks: [0, 4, 5], marginSeconds: 0.3, minimumDeadZoneSeconds: 2 },
  { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") },
);
const elapsedSeconds = (performance.now() - started) / 1000;

const framesPerSecond = recording.frameRate.numerator / recording.frameRate.denominator;
const minutes = (frames: number) => (frames / framesPerSecond / 60).toFixed(1);
const keptFrames = cutPlan.at(-1)?.timelineEnd ?? 0;

mkdirSync(outDir, { recursive: true });
const target = resolve(outDir, "long-recording-first-automatic-cut.xml");
writeFileSync(target, exportFcp7Xml(recording, cutPlan), "utf8");
console.log(
  `Analyse in ${elapsedSeconds.toFixed(0)} s: ${minutes(recording.durationFrames)} min Aufnahme, ` +
    `${minutes(keptFrames)} min behalten in ${cutPlan.length} Stücken`,
);
console.log(`geschrieben: ${target}`);
