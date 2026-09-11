import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { probeRecording, recordingInfoFromProbe } from "./probeRecording";

// Real `ffprobe -v error -print_format json -show_streams` output for the Recordings behind fixtures/premiere/.
// Expected values are transcribed from those Premiere exports, never from ffprobe's own numbers.
const multitrackProbe = readFileSync(
  new URL("../../fixtures/ffprobe/multitrack-6audio-60fps.json", import.meta.url),
  "utf8",
);
const singleProbe = readFileSync(new URL("../../fixtures/ffprobe/single-audio-30fps.json", import.meta.url), "utf8");

/** A real probe with fields of one stream replaced, to describe a Recording no fixture covers. `undefined` removes a field. */
function withStream(probe: string, streamIndex: number, fields: Record<string, unknown>): string {
  const parsed = JSON.parse(probe) as { streams: Record<string, unknown>[] };
  parsed.streams[streamIndex] = { ...parsed.streams[streamIndex], ...fields };
  return JSON.stringify(parsed);
}

describe("recordingInfoFromProbe", () => {
  test("frame rate, resolution and video length come out as Premiere read them", () => {
    const recording = recordingInfoFromProbe("C:\\media\\long-recording.mp4", multitrackProbe);

    expect({
      frameRate: recording.frameRate,
      width: recording.width,
      height: recording.height,
      durationFrames: recording.durationFrames,
    }).toEqual({ frameRate: { numerator: 60, denominator: 1 }, width: 1920, height: 1080, durationFrames: 546692 });
  });

  // AAC has no bit depth (ffprobe reports 0 bits per sample); both Premiere exports write 16 for it.
  test("every audio stream becomes a SourceTrack with its Channel count and sample rate, AAC at 16 bits", () => {
    const recording = recordingInfoFromProbe("C:\\media\\long-recording.mp4", multitrackProbe);

    expect(
      recording.sourceTracks.map(({ channelCount, sampleRate, bitDepth }) => ({ channelCount, sampleRate, bitDepth })),
    ).toEqual(Array.from({ length: 6 }, () => ({ channelCount: 2, sampleRate: 48000, bitDepth: 16 })));
  });

  // Measured in long-recording.mp4: all six audio streams are identical down to the MP4 boxes and end 546690.56 frames in,
  // yet Premiere gives SourceTrack 1 the video's length and rounds the other five down (ADR-0009).
  test("the first SourceTrack runs as long as the video, every later one ends at its last whole frame", () => {
    const recording = recordingInfoFromProbe("C:\\media\\long-recording.mp4", multitrackProbe);

    expect(recording.sourceTracks.map((sourceTrack) => sourceTrack.durationFrames)).toEqual([
      546692, 546690, 546690, 546690, 546690, 546690,
    ]);
  });

  // The second Premiere export. Its video counts time in 1/15360 s, and its only SourceTrack runs 4873.40 frames,
  // longer than the video; Premiere writes 4873 for both.
  test("a single-SourceTrack Recording comes out exactly as Premiere's single-track export read it", () => {
    const path = "C:\\media\\Single Track Test 🥶.mp4";

    expect(recordingInfoFromProbe(path, singleProbe)).toEqual({
      path,
      frameRate: { numerator: 30, denominator: 1 },
      width: 1280,
      height: 720,
      durationFrames: 4873,
      sourceTracks: [{ channelCount: 2, sampleRate: 44100, bitDepth: 16, durationFrames: 4873 }],
    });
  });

  // Frame positions are only times if every frame lasts equally long. Otherwise every cut drifts.
  test("a Recording whose frames do not fill its duration at the frame rate is refused as variable frame rate", () => {
    const variable = withStream(multitrackProbe, 0, { nb_frames: "546000" });

    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", variable)).toThrow(
      "C:\\media\\long-recording.mp4 has 546000 video frames, but its video lasts 546692 frames at 60/1 fps: the frame rate is not constant.",
    );
  });

  // Matroska, for one, reports no duration_ts per stream. A guessed length would move where clips end.
  test("a stream that does not report a value SmartTrim needs is refused instead of guessed", () => {
    const withoutLength = withStream(multitrackProbe, 2, { duration_ts: undefined });

    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", withoutLength)).toThrow(
      "C:\\media\\long-recording.mp4: SourceTrack 2 reports no duration_ts.",
    );
  });

  // Lossy codecs report 0 bits per sample. Only AAC's 16 is backed by the Premiere exports.
  test("an audio codec other than AAC that reports no bit depth is refused instead of written as 0 bits", () => {
    const opus = withStream(multitrackProbe, 1, { codec_name: "opus" });

    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", opus)).toThrow(
      "C:\\media\\long-recording.mp4: SourceTrack 1 is opus, which reports no bit depth; only AAC is backed by a Premiere export.",
    );
  });

  // Nothing shows which of several video streams Premiere would put on the timeline, so none is picked silently.
  test("a Recording without exactly one video stream is refused", () => {
    const { streams } = JSON.parse(multitrackProbe) as { streams: unknown[] };
    const twoVideoStreams = JSON.stringify({ streams: [streams[0], ...streams] });

    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", twoVideoStreams)).toThrow(
      "C:\\media\\long-recording.mp4 has 2 video streams; exactly one is needed.",
    );
  });

  // The export places every SourceTrack's clips at the same Recording frames as the video's.
  test("a stream that does not start with the Recording is refused", () => {
    const late = withStream(multitrackProbe, 3, { start_pts: 48000 });

    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", late)).toThrow(
      "C:\\media\\long-recording.mp4: SourceTrack 3 starts at pts 48000, not at the start of the Recording.",
    );
  });
});

// These tests run the real binaries in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));

describe("probeRecording", () => {
  let workDir: string;
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-probe-"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // Generated from known parameters, so no expected value comes from ffprobe: 60 frames at 29.97 fps, a first
  // SourceTrack at 48 kHz, and a second of exactly 1.5 s at 44.1 kHz, which spans 44.96 frames and ends early.
  test("reads a Recording through the real ffprobe, NTSC frame rate and a SourceTrack that ends early included", async () => {
    const recordingPath = join(workDir, "tiny.mov");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30000/1001"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"],
      ...["-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=1.5"],
      ...["-map", "0:v", "-map", "1:a", "-map", "2:a", "-frames:v", "60"],
      ...["-c:v", "mpeg4", "-c:a", "pcm_s16le", "-ac", "2", recordingPath],
    ]);

    expect(await probeRecording(recordingPath, vendor("ffprobe.exe"))).toEqual({
      path: recordingPath,
      frameRate: { numerator: 30000, denominator: 1001 },
      width: 320,
      height: 240,
      durationFrames: 60,
      sourceTracks: [
        { channelCount: 2, sampleRate: 48000, bitDepth: 16, durationFrames: 60 },
        { channelCount: 2, sampleRate: 44100, bitDepth: 16, durationFrames: 44 },
      ],
    });
  });

  test("a Recording ffprobe cannot read is reported with ffprobe's reason", async () => {
    const missingPath = join(workDir, "missing.mp4");

    await expect(probeRecording(missingPath, vendor("ffprobe.exe"))).rejects.toThrow(
      /^ffprobe could not read .+missing\.mp4: .*No such file or directory/,
    );
  });
});
