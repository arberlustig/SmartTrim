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

  // Measured on a 30-minute OBS Recording on 2026-10-23: all 109205 frames sit exactly on their 1/60 s, yet the video
  // reports 27956475 ticks of 1/15360 s, five short of the last frame's end. OBS writes the length in whole
  // milliseconds — 1820.083 s for 1820.0833… s — so at 60 fps two Recordings in three cannot fill it exactly (ADR-0009).
  test("frames that fill the video's duration to within the millisecond it is written in are a constant frame rate", () => {
    const obs = withStream(multitrackProbe, 0, { time_base: "1/15360", duration_ts: 27956475, nb_frames: "109205" });

    const recording = recordingInfoFromProbe("C:\\media\\long-recording.mp4", obs);

    expect(recording.durationFrames).toBe(109205);
    expect(recording.sourceTracks[0]?.durationFrames).toBe(109205);
  });

  // Measured on an NVIDIA App recording on 2026-10-24: every frame stays within 1.9 ms of its 1/60 s slot, but each
  // carries its own jittered length, so the video ends where the last frame's jitter leaves it — here 19892 frames in
  // 29837821 ticks of 1/90000 s, 19891.88 frames, 2 ms short. A user's 78-minute Recording was refused at 280521.9.
  test("frames that fill the video's duration to within half a frame are a constant frame rate", () => {
    const nvidia = withStream(multitrackProbe, 0, { time_base: "1/90000", duration_ts: 29837821, nb_frames: "19892" });
    const longer = withStream(multitrackProbe, 0, { time_base: "1/90000", duration_ts: 280522 * 1500 - 150, nb_frames: "280522" });
    // Another NVIDIA App recording ends a millisecond after its last frame's slot: 589 frames in 589.06.
    const pastItsFrames = withStream(multitrackProbe, 0, { time_base: "1/90000", duration_ts: 883590, nb_frames: "589" });

    expect(recordingInfoFromProbe("C:\\media\\long-recording.mp4", nvidia).durationFrames).toBe(19892);
    expect(recordingInfoFromProbe("C:\\media\\long-recording.mp4", longer).durationFrames).toBe(280522);
    expect(recordingInfoFromProbe("C:\\media\\long-recording.mp4", pastItsFrames).durationFrames).toBe(589);
  });

  // A frame dropped or doubled moves the count by a whole frame, jitter or not.
  test("frames that miss the video's duration by half a frame or more are still refused", () => {
    const short = withStream(multitrackProbe, 0, { time_base: "1/90000", duration_ts: 19892 * 1500 - 750, nb_frames: "19892" });
    const long = withStream(multitrackProbe, 0, { time_base: "1/90000", duration_ts: 19892 * 1500 + 750, nb_frames: "19892" });

    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", short)).toThrow(
      "C:\\media\\long-recording.mp4 has 19892 video frames, but its video lasts 19891.5 frames at 60/1 fps: the frame rate is not constant.",
    );
    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", long)).toThrow(
      "C:\\media\\long-recording.mp4 has 19892 video frames, but its video lasts 19892.5 frames at 60/1 fps: the frame rate is not constant.",
    );
  });

  // Measured with the vendor ffprobe on an MP4 whose frames were all given the same moment: it reports 1/0. Every
  // check divides by the frame rate, so none of them may speak about such a video first.
  test("a video whose frame rate is no frame rate is refused as such", () => {
    const stuck = withStream(multitrackProbe, 0, { r_frame_rate: "1/0" });

    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", stuck)).toThrow(
      "C:\\media\\long-recording.mp4: the video stream reports a frame rate of 1/0.",
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

  // A user's Recording, named the way OBS names them, was refused on 2026-10-24 because its video started at pts 90:
  // a millisecond in 1/90000 s (an ffmpeg remux to MP4, the likely reading), 5.9 ms in the 1/15360 s of OBS's ffmpeg
  // MP4 — or 1.5 s in OBS's hybrid MP4 at 60 fps, which stays refused (ADR-0009). No frame the export writes can tell
  // a start under half a frame from the Recording's.
  test("a stream that starts within half a frame of the Recording counts as starting with it", () => {
    const original = recordingInfoFromProbe("C:\\media\\long-recording.mp4", multitrackProbe);
    const millisecondLate = withStream(multitrackProbe, 0, { time_base: "1/90000", start_pts: 90, duration_ts: 546692 * 1500 });
    const almostHalfAFrameLate = withStream(multitrackProbe, 0, { time_base: "1/15360", start_pts: 127, duration_ts: 546692 * 256 });
    const almostHalfAFrameEarly = withStream(multitrackProbe, 4, { start_pts: -399 });

    expect(recordingInfoFromProbe("C:\\media\\long-recording.mp4", millisecondLate)).toEqual(original);
    expect(recordingInfoFromProbe("C:\\media\\long-recording.mp4", almostHalfAFrameLate)).toEqual(original);
    expect(recordingInfoFromProbe("C:\\media\\long-recording.mp4", almostHalfAFrameEarly)).toEqual(original);
  });

  // The export places every SourceTrack's clips at the same Recording frames as the video's, and the audio is read
  // from its own first sample: a stream half a frame or more away from the start would shift every cut. How far off
  // it is goes into the refusal, so the next report tells how far, whatever the time base.
  test("a stream that starts half a frame or more away from the Recording is refused, saying how far", () => {
    const late = withStream(multitrackProbe, 3, { start_pts: 48000 });
    const halfAFrameLate = withStream(multitrackProbe, 0, { time_base: "1/15360", start_pts: 128, duration_ts: 546692 * 256 });
    const videoAfterAnEmptyEdit = withStream(multitrackProbe, 0, { start_pts: 90 });
    const primingLeftIn = withStream(multitrackProbe, 1, { start_pts: -1024 });

    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", late)).toThrow(
      "C:\\media\\long-recording.mp4: SourceTrack 3 starts 1000 ms after the start of the Recording (pts 48000 in 1/48000 s); only a stream that starts within half a frame of it can be cut exactly.",
    );
    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", halfAFrameLate)).toThrow(
      "C:\\media\\long-recording.mp4: the video stream starts 8.33 ms after the start of the Recording (pts 128 in 1/15360 s); only a stream that starts within half a frame of it can be cut exactly.",
    );
    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", videoAfterAnEmptyEdit)).toThrow(
      "C:\\media\\long-recording.mp4: the video stream starts 1500 ms after the start of the Recording (pts 90 in 1/60 s); only a stream that starts within half a frame of it can be cut exactly.",
    );
    expect(() => recordingInfoFromProbe("C:\\media\\long-recording.mp4", primingLeftIn)).toThrow(
      "C:\\media\\long-recording.mp4: SourceTrack 1 starts 21.33 ms before the start of the Recording (pts -1024 in 1/48000 s); only a stream that starts within half a frame of it can be cut exactly.",
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

  // Written the way an ffmpeg remux to MP4 leaves a video that began a millisecond after the sound: an empty edit,
  // which ffprobe reports as start_pts 90 in 1/90000 s — the refusal a user saw on 2026-10-24.
  test("reads a Recording whose video starts a millisecond after its sound as one that starts with it", async () => {
    const encodedPath = join(workDir, "encoded.mp4");
    const recordingPath = join(workDir, "video-a-millisecond-late.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=60"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"],
      ...["-map", "0:v", "-map", "1:a", "-frames:v", "120"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-ac", "2", "-video_track_timescale", "90000", encodedPath],
    ]);
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-itsoffset", "0.001", "-i", encodedPath, "-i", encodedPath],
      ...["-map", "0:v", "-map", "1:a", "-c", "copy", "-video_track_timescale", "90000", recordingPath],
    ]);
    const starts = execFileSync(
      vendor("ffprobe.exe"),
      ["-v", "error", "-show_entries", "stream=start_pts", "-of", "csv=p=0", recordingPath],
      { encoding: "utf8" },
    );
    expect(starts.trim().split(/\r?\n/)).toEqual(["90", "0"]);

    expect(await probeRecording(recordingPath, vendor("ffprobe.exe"))).toEqual({
      path: recordingPath,
      frameRate: { numerator: 60, denominator: 1 },
      width: 320,
      height: 240,
      durationFrames: 120,
      sourceTracks: [{ channelCount: 2, sampleRate: 48000, bitDepth: 16, durationFrames: 120 }],
    });
  });

  test("a Recording ffprobe cannot read is reported with ffprobe's reason", async () => {
    const missingPath = join(workDir, "missing.mp4");

    await expect(probeRecording(missingPath, vendor("ffprobe.exe"))).rejects.toThrow(
      /^ffprobe could not read .+missing\.mp4: .*No such file or directory/,
    );
  });
});
