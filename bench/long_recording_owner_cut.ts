/**
 * The cut the owner picked on 2026-09-12 after listening: loudness above -40 dBFS on the microphone SourceTrack,
 * a Margin of 0.05 s and a MinimumDeadZone of 0.25 s. Not product code.
 *
 * It goes through analyseRecording, the way the app will, and compares the result with the file the owner judged,
 * bench/out/long-recording-spur5-pegel40db.xml, which bench/level_vs_voice.ts wrote from its own loudness measurement.
 *
 * Usage (from the repository root): node bench/long_recording_owner_cut.ts "C:\path\to\long-recording.mp4" [SourceTrack number]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseRecording } from "../src/analysis/analyseRecording.ts";
import { exportFcp7Xml } from "../src/export/exportFcp7Xml.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = (name: string) => resolve(repoRoot, "vendor", name);
const outDir = resolve(repoRoot, "bench", "out");

const [recordingPath, sourceTrackNumber = "5"] = process.argv.slice(2);
if (!recordingPath || !existsSync(recordingPath)) {
  console.error('Aufruf: node bench/long_recording_owner_cut.ts "C:\...\long-recording.mp4" [Spurnummer]');
  process.exit(1);
}

const started = performance.now();
const { recording, worthKeeping, cutPlan } = await analyseRecording(
  {
    recordingPath,
    voiceSourceTracks: [Number(sourceTrackNumber) - 1],
    decideBy: { kind: "loudness", thresholdDbfs: -40 },
    marginSeconds: 0.05,
    minimumDeadZoneSeconds: 0.25,
  },
  { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") },
);
const elapsedSeconds = (performance.now() - started) / 1000;

const framesPerSecond = recording.frameRate.numerator / recording.frameRate.denominator;
const minutes = (frames: number) => frames / framesPerSecond / 60;
const keptMinutes = minutes(cutPlan.at(-1)?.timelineEnd ?? 0);

mkdirSync(outDir, { recursive: true });
const target = resolve(outDir, "long-recording-owner-cut.xml");
const xml = exportFcp7Xml(recording, cutPlan);
writeFileSync(target, xml, "utf8");
console.log(
  `Analyse in ${elapsedSeconds.toFixed(0)} s: ${minutes(recording.durationFrames).toFixed(1)} min Aufnahme, ` +
    `${worthKeeping.length} laute Stellen, ${keptMinutes.toFixed(1)} min behalten ` +
    `(${(100 * (1 - keptMinutes / minutes(recording.durationFrames))).toFixed(0)} % weg) in ${cutPlan.length} Stücken`,
);
console.log(`geschrieben: ${target}`);

const judged = resolve(outDir, `long-recording-spur${sourceTrackNumber}-pegel40db.xml`);
if (existsSync(judged)) {
  // Where the Recording lives is written into the XML, and long-recording.mp4 has moved since the owner listened
  // (C:\Users\user\Downloads then, G:\Streams on 2026-09-13). Only the cut is compared, so that one
  // line is left out; comparing the whole file reported every later run as a different cut.
  const pathOf = (text: string) => text.match(/<pathurl>[^<]*<\/pathurl>/)?.[0] ?? "";
  const withoutPath = (text: string) => text.replace(/<pathurl>[^<]*<\/pathurl>/g, "<pathurl/>");
  const digest = (text: string) => createHash("sha256").update(withoutPath(text)).digest("hex");
  const judgedText = readFileSync(judged, "utf8");
  const same = digest(xml) === digest(judgedText);
  const moved = pathOf(xml) !== pathOf(judgedText);
  console.log(
    `identisch mit der von dir gehoerten Datei: ${same ? "ja" : "NEIN"}` +
      (same && moved ? " (nur der Speicherort der Aufnahme ist ein anderer)" : ""),
  );
} else {
  console.log(`Vergleichsdatei fehlt: ${judged}`);
}
