/**
 * Asks two ffmpeg builds everything SmartTrim asks of ffmpeg and ffprobe, and says whether their answers are the same
 * byte for byte: the probe, the scan's levels, every SourceTrack decoded for speech detection, an Excerpt of every
 * SourceTrack, and a few picture frames. This is how the pinned build is moved to another one without re-running every
 * measurement the ADRs rest on (ADR-0031): where the answers are identical, so is everything built on them. Not product
 * code.
 *
 * Usage (from the repository root):
 *   node bench/compare_ffmpeg_builds.ts <old tools folder> <new tools folder> "C:\path\to\recording.mp4" [more …]
 * Each tools folder holds ffmpeg.exe and ffprobe.exe. The builds run one after the other, never side by side, the old
 * one first: on a Recording not yet in the file cache the old build pays for reading it from disk and the new one does
 * not, so the times only compare on a second run. The verdict never depends on them.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { decodeSourceTracks } from "../src/decode/decodeSourceTracks.ts";
import type { RecordingInfo } from "../src/export/exportFcp7Xml.ts";
import { readExcerpt } from "../src/playback/readExcerpt.ts";
import { probeRecording } from "../src/probe/probeRecording.ts";
import { scanSourceTracks } from "../src/scan/scanSourceTracks.ts";

const [oldFolder, newFolder, ...recordingPaths] = process.argv.slice(2);
if (!oldFolder || !newFolder || recordingPaths.length === 0) {
  console.error('Aufruf: node bench/compare_ffmpeg_builds.ts <alter Ordner> <neuer Ordner> "C:\\...\\aufnahme.mp4" [...]');
  process.exit(1);
}

const sha256 = (view: ArrayBufferView) =>
  createHash("sha256").update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).digest("hex");

/** The picture's own arguments in software (ADR-0028), for a handful of frames a minute in. */
function pictureFrames(ffmpeg: string, recording: RecordingInfo): Promise<string> {
  const args = [
    ...["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", "60.000000", "-i", recording.path],
    ...["-map", "0:v:0", "-frames:v", "5", "-vf", "scale=640:360", "-pix_fmt", "yuvj420p", "-c:v", "mjpeg"],
    ...["-q:v", "8", "-threads", "4", "-f", "image2pipe", "-"],
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const hash = createHash("sha256");
    const messages: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => hash.update(chunk));
    child.stderr.on("data", (chunk: Buffer) => messages.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(hash.digest("hex")) : reject(new Error(Buffer.concat(messages).toString("utf8").trim())),
    );
  });
}

/** Everything one build says about one Recording, reduced to what can be compared, and how long each part took. */
async function answersOf(
  folder: string,
  recordingPath: string,
): Promise<{ answers: Record<string, unknown>; seconds: Record<string, number> }> {
  const ffmpeg = join(folder, "ffmpeg.exe");
  const ffprobe = join(folder, "ffprobe.exe");
  const seconds: Record<string, number> = {};
  const timed = async <Value>(part: string, run: () => Promise<Value>): Promise<Value> => {
    const started = performance.now();
    const value = await run();
    seconds[part] = (performance.now() - started) / 1000;
    return value;
  };

  let recording: RecordingInfo;
  try {
    recording = await timed("recording", () => probeRecording(recordingPath, ffprobe));
  } catch (error) {
    // A Recording SmartTrim refuses must be refused by both builds, for the same reason.
    return { answers: { recording: { refused: (error as Error).message } }, seconds };
  }
  const scan = await timed("scan", () => scanSourceTracks(recording, ffmpeg));
  const indexes = recording.sourceTracks.map((_sourceTrack, index) => index);
  const decoded = await timed("decoded", () =>
    decodeSourceTracks(recording, indexes, ffmpeg, (_index, pcm) => ({
      sampleRate: pcm.sampleRate,
      samples: pcm.samples.length,
      sha256: sha256(pcm.samples),
    })),
  );
  const recordingSeconds = (recording.durationFrames * recording.frameRate.denominator) / recording.frameRate.numerator;
  // Half a minute from the middle: seeking before the input is what an Excerpt does (ADR-0022).
  const from = Math.max(0, Math.floor(recordingSeconds / 2) - 15);
  const excerpts = await timed("excerpts", () =>
    Promise.all(
      indexes.map(async (index) => {
        const excerpt = await readExcerpt(recording, index, from, Math.min(from + 30, recordingSeconds), ffmpeg);
        return { ...excerpt, channels: excerpt.channels.map((channel) => `${channel.length} ${sha256(channel)}`) };
      }),
    ),
  );
  const picture = await timed("picture", () => pictureFrames(ffmpeg, recording));
  return { answers: { recording, scan, decoded, excerpts, picture }, seconds };
}

let allSame = true;
for (const recordingPath of recordingPaths) {
  console.log(`\n${recordingPath}`);
  const before = await answersOf(oldFolder, recordingPath);
  const after = await answersOf(newFolder, recordingPath);
  const parts = new Set([...Object.keys(before.answers), ...Object.keys(after.answers)]);
  for (const part of parts) {
    const same = isDeepStrictEqual(before.answers[part], after.answers[part]);
    // The picture is only looked at; a different JPEG encoder changes no cut and no measurement.
    if (!same && part !== "picture") allSame = false;
    console.log(
      `  ${part.padEnd(9)} ${same ? "gleich" : "VERSCHIEDEN"}   ` +
        `alt ${(before.seconds[part] ?? NaN).toFixed(1)} s, neu ${(after.seconds[part] ?? NaN).toFixed(1)} s`,
    );
    if (!same && part !== "picture") {
      console.log(`    alt: ${JSON.stringify(before.answers[part]).slice(0, 600)}`);
      console.log(`    neu: ${JSON.stringify(after.answers[part]).slice(0, 600)}`);
    }
  }
}
console.log(allSame ? "\nAlles, worauf Schnitt und Messungen beruhen, ist gleich." : "\nEs gibt Unterschiede (siehe oben).");
process.exit(allSame ? 0 : 1);
