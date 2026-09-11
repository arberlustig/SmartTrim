/**
 * Writes FCP7 XML for the owner's own long-recording.mp4, so a real Premiere import can confirm the export.
 * Not product code. The Recording's properties are transcribed from fixtures/premiere/multitrack-6audio-60fps.xml,
 * which Premiere wrote for this very file, and are checked against ffprobe before anything is written.
 *
 * Usage (from the repository root): node bench/long_recording_import_check.ts "D:\path\to\long-recording.mp4"
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CutPlan } from "../src/cutting/planCuts.ts";
import { exportFcp7Xml, type RecordingInfo } from "../src/export/exportFcp7Xml.ts";

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

// What Premiere wrote for long-recording.mp4 in fixtures/premiere/multitrack-6audio-60fps.xml.
const FRAME_RATE = "60/1";
const WIDTH = 1920;
const HEIGHT = 1080;
const VIDEO_FRAMES = 546692;
const SOURCE_TRACK_FRAMES = [546692, 546690, 546690, 546690, 546690, 546690];
const SAMPLE_RATE = "48000";

interface ProbeStream {
  codec_type: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
}

// A too-small buffer makes execFileSync throw ENOBUFS; it never truncates silently.
const probe = JSON.parse(
  execFileSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", recordingPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
) as { streams: ProbeStream[] };

const videoStreams = probe.streams.filter((stream) => stream.codec_type === "video");
const audioStreams = probe.streams.filter((stream) => stream.codec_type === "audio");
const problems: string[] = [];

if (videoStreams.length !== 1) problems.push(`erwartet 1 Videostream, gefunden ${videoStreams.length}`);
const video = videoStreams[0];
if (video && (video.width !== WIDTH || video.height !== HEIGHT)) {
  problems.push(`Video ist ${video.width}x${video.height}, erwartet ${WIDTH}x${HEIGHT}`);
}
if (video && video.r_frame_rate !== FRAME_RATE) problems.push(`Framerate ist ${video.r_frame_rate}, erwartet ${FRAME_RATE}`);
if (audioStreams.length !== SOURCE_TRACK_FRAMES.length) {
  problems.push(`erwartet ${SOURCE_TRACK_FRAMES.length} Audiospuren, gefunden ${audioStreams.length}`);
}
audioStreams.forEach((stream, index) => {
  if (stream.channels !== 2) problems.push(`SourceTrack ${index + 1} hat ${stream.channels} Kanäle, erwartet 2`);
  if (stream.sample_rate !== SAMPLE_RATE) {
    problems.push(`SourceTrack ${index + 1} hat ${stream.sample_rate} Hz, erwartet ${SAMPLE_RATE}`);
  }
});

if (problems.length > 0) {
  fail(`Das ist nicht die Datei, zu der die Fixture gehört. Nichts geschrieben.\n  - ${problems.join("\n  - ")}`);
}

// For information only: how ffprobe's stream lengths compare with the frame counts Premiere wrote.
// Turning durations into frames is the job of the probe module that does not exist yet.
audioStreams.forEach((stream, index) => {
  const probedFrames = Number(stream.duration) * 60;
  console.log(
    `SourceTrack ${index + 1}: ffprobe ${stream.duration} s ≈ ${probedFrames.toFixed(1)} Frames, Premiere ${SOURCE_TRACK_FRAMES[index]}`,
  );
});

const recording: RecordingInfo = {
  path: resolve(recordingPath),
  frameRate: { numerator: 60, denominator: 1 },
  width: WIDTH,
  height: HEIGHT,
  durationFrames: VIDEO_FRAMES,
  sourceTracks: SOURCE_TRACK_FRAMES.map((durationFrames) => ({
    channelCount: 2,
    sampleRate: Number(SAMPLE_RATE),
    bitDepth: 16,
    durationFrames,
  })),
};

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
