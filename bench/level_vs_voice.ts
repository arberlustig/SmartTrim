/**
 * Compares the two ways of deciding what to remove on one real SourceTrack: Silero's speech detection against a
 * plain loudness threshold, the way QuietCut and auto-editor decide. Not product code.
 *
 * Both go through the same post-processing and the same planCuts settings, so the detector is the only difference.
 * For every threshold it reports how much is removed and how much of the speech Silero found would be cut away.
 *
 * Usage (from the repository root): node bench/level_vs_voice.ts "C:\path\to\recording.mp4" [SourceTrack number]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planCuts, type CutPlan, type TimeRange } from "../src/cutting/planCuts.ts";
import { decodeSourceTracks } from "../src/decode/decodeSourceTracks.ts";
import { exportFcp7Xml } from "../src/export/exportFcp7Xml.ts";
import { probeRecording } from "../src/probe/probeRecording.ts";
import { detectSpeech, speechRanges } from "../src/speech/detectSpeech.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = (name: string) => resolve(repoRoot, "vendor", name);
const outDir = resolve(repoRoot, "bench", "out");

const [recordingPath, sourceTrackNumber = "5"] = process.argv.slice(2);
if (!recordingPath || !existsSync(recordingPath)) {
  console.error('Aufruf: node bench/level_vs_voice.ts "C:\...\long-recording.mp4" [Spurnummer]');
  process.exit(1);
}

// The settings the owner accepted as "Grenze" on 2026-09-12.
const MARGIN_SECONDS = 0.05;
const MINIMUM_DEAD_ZONE_SECONDS = 0.25;
const CHUNK_SAMPLES = 512;
const THRESHOLDS_DBFS = [-50, -45, -40, -35, -30];

const recording = await probeRecording(recordingPath, vendor("ffprobe.exe"));
const sourceTrackIndex = Number(sourceTrackNumber) - 1;
const [pcm] = await decodeSourceTracks(recording, [sourceTrackIndex], vendor("ffmpeg.exe"));
if (!pcm) throw new Error("nothing decoded");

const framesPerSecond = recording.frameRate.numerator / recording.frameRate.denominator;
const minutes = (frames: number) => frames / framesPerSecond / 60;
const recordingMinutes = minutes(recording.durationFrames);

/** One loudness per 512 samples, the grid Silero scores on. */
const chunkLevels = () => {
  const levels = new Float32Array(Math.floor(pcm.samples.length / CHUNK_SAMPLES));
  for (let chunk = 0; chunk < levels.length; chunk++) {
    let sum = 0;
    for (let offset = 0; offset < CHUNK_SAMPLES; offset++) {
      const sample = (pcm.samples[chunk * CHUNK_SAMPLES + offset] ?? 0) / 32768;
      sum += sample * sample;
    }
    levels[chunk] = 20 * Math.log10(Math.max(Math.sqrt(sum / CHUNK_SAMPLES), 1e-10));
  }
  return levels;
};

const plan = (ranges: readonly TimeRange[]) =>
  planCuts({
    recording,
    speech: ranges,
    contentEvents: [],
    lockedRanges: [],
    marginSeconds: MARGIN_SECONDS,
    eventLeadSeconds: 0,
    eventTailSeconds: 0,
    minimumDeadZoneSeconds: MINIMUM_DEAD_ZONE_SECONDS,
  });

/** How many seconds of the speech Silero found lie outside what a CutPlan keeps. */
const speechCutAway = (cutPlan: CutPlan, speech: readonly TimeRange[]) => {
  const kept = cutPlan.map((segment) => [segment.recordingIn / framesPerSecond, segment.recordingOut / framesPerSecond]);
  let lost = 0;
  for (const range of speech) {
    let covered = 0;
    for (const [from, to] of kept) {
      covered += Math.max(0, Math.min(to ?? 0, range.endSeconds) - Math.max(from ?? 0, range.startSeconds));
    }
    lost += range.endSeconds - range.startSeconds - covered;
  }
  return lost;
};

const started = performance.now();
const speech = await detectSpeech(pcm, vendor("silero_vad.onnx"));
const levels = chunkLevels();
const sorted = Float32Array.from(levels).sort();
const percentile = (share: number) => sorted[Math.floor(share * (sorted.length - 1))] ?? NaN;
console.log(
  `Spur ${sourceTrackNumber}: ${recordingMinutes.toFixed(1)} min, Analyse in ${((performance.now() - started) / 1000).toFixed(0)} s. ` +
    `Pegel: leiseste 10 % unter ${percentile(0.1).toFixed(0)} dBFS, Mitte ${percentile(0.5).toFixed(0)} dBFS, lauteste 10 % über ${percentile(0.9).toFixed(0)} dBFS`,
);

mkdirSync(outDir, { recursive: true });
const report = (label: string, cutPlan: CutPlan, lostSeconds: number, target?: string) => {
  const keptMinutes = minutes(cutPlan.at(-1)?.timelineEnd ?? 0);
  console.log(
    `${label.padEnd(22)} ${keptMinutes.toFixed(1)} min behalten (${(100 * (1 - keptMinutes / recordingMinutes)).toFixed(0)} % weg), ` +
      `${cutPlan.length} Stücke, ${(lostSeconds / 60).toFixed(1)} min Sprache weggeschnitten${target ? ` -> ${target}` : ""}`,
  );
};

const voicePlan = plan(speech);
report("Stimmerkennung", voicePlan, speechCutAway(voicePlan, speech));

for (const threshold of THRESHOLDS_DBFS) {
  const loudPlan = plan(speechRanges(Array.from(levels, (level) => (level > threshold ? 1 : 0))));
  // Only the two most promising thresholds become a file: at these settings every export runs to tens of megabytes.
  const target = [-40, -35].includes(threshold)
    ? resolve(outDir, `long-recording-spur${sourceTrackNumber}-pegel${Math.abs(threshold)}db.xml`)
    : undefined;
  if (target) writeFileSync(target, exportFcp7Xml(recording, loudPlan), "utf8");
  report(`Pegel über ${threshold} dBFS`, loudPlan, speechCutAway(loudPlan, speech), target);
}
