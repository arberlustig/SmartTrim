/**
 * Writes the same Recording's cut with several settings, so the owner can compare them in Premiere. Not product code.
 * The Recording is analysed once; every variant only replans the cuts from the speech already found (ADR-0004).
 *
 * Usage (from the repository root): node bench/long_recording_settings_variants.ts "C:\path\to\long-recording.mp4" [SourceTrack numbers]
 * Without numbers it listens to SourceTracks 1, 5 and 6, where ADR-0010 found speech.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseRecording } from "../src/analysis/analyseRecording.ts";
import { planCuts } from "../src/cutting/planCuts.ts";
import { exportFcp7Xml } from "../src/export/exportFcp7Xml.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = (name: string) => resolve(repoRoot, "vendor", name);
const outDir = resolve(repoRoot, "bench", "out");

const [recordingPath, ...sourceTrackNumbers] = process.argv.slice(2);
if (!recordingPath || !existsSync(recordingPath)) {
  console.error('Aufruf: node bench/long_recording_settings_variants.ts "C:\...\long-recording.mp4" [Spurnummern]');
  process.exit(1);
}
const listenedTo = sourceTrackNumbers.length > 0 ? sourceTrackNumbers.map(Number) : [1, 5, 6];
const fileLabel = sourceTrackNumbers.length > 0 ? `spur${sourceTrackNumbers.join("-")}-` : "";

// One variable at a time would take too long here, so both move together: less Margin means less silence kept at
// every cut, a smaller MinimumDeadZone means shorter pauses are removed at all.
const variants = [
  { name: "wie-gehabt", marginSeconds: 0.3, minimumDeadZoneSeconds: 2 },
  { name: "sanft", marginSeconds: 0.2, minimumDeadZoneSeconds: 1.2 },
  { name: "mittel", marginSeconds: 0.15, minimumDeadZoneSeconds: 0.8 },
  { name: "streng", marginSeconds: 0.1, minimumDeadZoneSeconds: 0.5 },
  { name: "sehr-streng", marginSeconds: 0.08, minimumDeadZoneSeconds: 0.35 },
  { name: "grenze", marginSeconds: 0.05, minimumDeadZoneSeconds: 0.25 },
];

const started = performance.now();
const { recording, worthKeeping } = await analyseRecording(
  {
    recordingPath,
    voiceSourceTracks: listenedTo.map((number) => number - 1),
    marginSeconds: 0.3,
    minimumDeadZoneSeconds: 2,
  },
  { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") },
);
const framesPerSecond = recording.frameRate.numerator / recording.frameRate.denominator;
const minutes = (frames: number) => frames / framesPerSecond / 60;
const spokenMinutes = worthKeeping.reduce((total, range) => total + (range.endSeconds - range.startSeconds), 0) / 60;
console.log(
  `Spur ${listenedTo.join(", ")}: Analyse in ${((performance.now() - started) / 1000).toFixed(0)} s, ` +
    `${minutes(recording.durationFrames).toFixed(1)} min Aufnahme, ${worthKeeping.length} Sprechstellen, ` +
    `${spokenMinutes.toFixed(1)} min davon gesprochen`,
);

mkdirSync(outDir, { recursive: true });
for (const variant of variants) {
  const cutPlan = planCuts({
    recording,
    speech: worthKeeping,
    contentEvents: [],
    lockedRanges: [],
    marginSeconds: variant.marginSeconds,
    eventLeadSeconds: 0,
    eventTailSeconds: 0,
    minimumDeadZoneSeconds: variant.minimumDeadZoneSeconds,
  });
  const keptMinutes = minutes(cutPlan.at(-1)?.timelineEnd ?? 0);
  const target = resolve(outDir, `long-recording-${fileLabel}${variant.name}.xml`);
  writeFileSync(target, exportFcp7Xml(recording, cutPlan), "utf8");
  console.log(
    `${variant.name.padEnd(11)} Luft ${variant.marginSeconds.toFixed(2)} s, Pausen ab ${variant.minimumDeadZoneSeconds.toFixed(2)} s raus: ` +
      `${keptMinutes.toFixed(1)} min behalten (${(100 * (1 - keptMinutes / minutes(recording.durationFrames))).toFixed(0)} % weg), ` +
      `${cutPlan.length} Stücke -> ${target}`,
  );
}
