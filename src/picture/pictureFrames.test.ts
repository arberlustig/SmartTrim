import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import { probeRecording } from "../probe/probeRecording";
import { newPictureFrames, type PictureFrames } from "./pictureFrames";

// These tests run the real binaries in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));

const HEIGHT = 90;

/** How bright a picture is, 0 to 255: decoded to grey and its pixels averaged. */
function brightnessOf(jpeg: Uint8Array): number {
  const grey = execFileSync(vendor("ffmpeg.exe"), ["-v", "error", "-f", "jpeg_pipe", "-i", "-", "-vf", "format=gray", "-f", "rawvideo", "-"], {
    input: jpeg,
  });
  return grey.reduce((sum, value) => sum + value, 0) / grey.length;
}

/**
 * Frame `number` of the Recording as a JPEG made the independent way: the whole video decoded from its start and the
 * frame picked by its number, never by a time — then scaled and encoded as the picture is.
 */
function referenceJpeg(path: string, number: number): Uint8Array {
  return execFileSync(vendor("ffmpeg.exe"), [
    ...["-v", "error", "-i", path, "-map", "0:v:0"],
    ...["-vf", `select=eq(n\\,${number}),scale=-2:${HEIGHT}`, "-frames:v", "1"],
    ...["-pix_fmt", "yuvj420p", "-c:v", "mjpeg", "-q:v", "8", "-f", "image2pipe", "-"],
  ]);
}

/** Which of `candidates` the picture is: the reference frame closest to it in brightness. */
function whichFrame(jpeg: Uint8Array, path: string, candidates: readonly number[]): number {
  const bright = brightnessOf(jpeg);
  const distances = candidates.map((number) => Math.abs(brightnessOf(referenceJpeg(path, number)) - bright));
  return candidates[distances.indexOf(Math.min(...distances))] as number;
}

async function madeFrame(pictures: PictureFrames, recording: RecordingInfo, index: number): Promise<Uint8Array> {
  return vi.waitFor(
    () => {
      const [jpeg] = pictures.frames(recording, [index]);
      if (!jpeg) throw new Error(`frame ${index} not made yet`);
      return jpeg;
    },
    { timeout: 15000, interval: 20 },
  );
}

describe("pictureFrames", () => {
  let workDir: string;
  let recording: RecordingInfo;

  // Built like an OBS Recording where every frame can be told apart: 20 s of H.264 at 30 frames a second with a
  // keyframe every 3 s, so most moments lie between keyframes; frame n is flat grey at 16 + 4 · (n mod 50). One AAC
  // SourceTrack, as the probe expects.
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-picture-"));
    const path = join(workDir, "numbered-frames.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", "color=black:size=160x90:rate=30:duration=20,format=yuv420p,geq=lum='16+4*mod(N\\,50)':cb=128:cr=128"],
      ...["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"],
      ...["-map", "0:v", "-map", "1:a", "-t", "20"],
      ...["-c:v", "libopenh264", "-g", "90", "-b:v", "2M", "-c:a", "aac", path],
    ]);
    recording = await probeRecording(path, vendor("ffprobe.exe"));
  }, 60000);
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // The picture follows the sound frame by frame, so frame k has to be the frame on screen at k / fps — whichever
  // moment ffmpeg was started from. 5 s is frame 150, two seconds past the keyframe at frame 90.
  test("frame k is the frame at k / fps, whether ffmpeg starts well before it or right at it", async () => {
    const fromBefore = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 2 });
    const fromThere = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 2 });
    try {
      fromBefore.want(recording, 4.0);
      fromThere.want(recording, 5.0);

      const path = recording.path;
      expect(whichFrame(await madeFrame(fromBefore, recording, 150), path, [149, 150, 151])).toBe(150);
      expect(whichFrame(await madeFrame(fromBefore, recording, 151), path, [150, 151, 152])).toBe(151);
      expect(whichFrame(await madeFrame(fromThere, recording, 150), path, [149, 150, 151])).toBe(150);
      expect(whichFrame(await madeFrame(fromThere, recording, 151), path, [150, 151, 152])).toBe(151);
    } finally {
      fromBefore.stop();
      fromThere.stop();
    }
  }, 60000);

  // A click elsewhere must not leave the graphics card busy with frames nobody will see, and a click back into a stretch
  // already made must not make it again: on the owner's Recordings one run of three minutes is 15 s of ffmpeg.
  test("a wish elsewhere stops the ffmpeg still at work, and frames already made are not made again", async () => {
    const pictures = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 15 });
    try {
      // Frames 0–449 are asked for, and before ffmpeg has made them the wish moves to 16 s: frames 480–599.
      pictures.want(recording, 0);
      pictures.want(recording, 16);
      await madeFrame(pictures, recording, 599);
      await vi.waitFor(() => expect(pictures.runs().some((run) => run.running)).toBe(false), { timeout: 15000 });
      expect(pictures.runs()).toMatchObject([
        { fromFrame: 0, toFrame: 450, stopped: true },
        { fromFrame: 480, toFrame: 600, made: 120, stopped: false },
      ]);
      expect(pictures.frames(recording, [300])).toEqual([null]);

      // From 17 s everything is made already: nothing starts.
      pictures.want(recording, 17);
      expect(pictures.runs()).toHaveLength(2);
      // From 15 s only frames 450–479 are missing, so ffmpeg is asked for those and no more.
      pictures.want(recording, 15);
      expect(pictures.runs().at(-1)).toMatchObject({ fromFrame: 450, toFrame: 480 });
    } finally {
      pictures.stop();
    }
  }, 60000);

  // The owner's machine decodes on its NVIDIA card; other machines have none, or a driver that refuses. ffmpeg then
  // exits with an error and no frame, and the picture must still come — from the processor, about half as fast. One
  // refusal is no proof there is no card, though: a start refused the moment after a run was stopped would otherwise
  // leave the whole Recording on the slow processor. Only three refusals in a row settle it.
  test("when the graphics card's decoder fails the frames come from the processor, and the card is tried again until it failed three times", async () => {
    const broken = { hwaccel: "nosuchdecoder", scale: (width: number, height: number) => `scale=${width}:${height}` };
    const pictures = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 1, hardware: broken });
    try {
      pictures.want(recording, 3);
      expect(whichFrame(await madeFrame(pictures, recording, 100), recording.path, [99, 100, 101])).toBe(100);
      for (const seconds of [6, 9, 12]) {
        pictures.want(recording, seconds);
        await madeFrame(pictures, recording, seconds * 30);
      }

      expect(pictures.runs().map((run) => [run.fromFrame, run.onProcessor])).toEqual([
        [90, false],
        [90, true],
        [180, false],
        [180, true],
        [270, false],
        [270, true],
        [360, true],
      ]);
    } finally {
      pictures.stop();
    }
  }, 60000);

  // Three minutes of the owner's Recordings are 340–600 MB of frames, and every place clicked adds three more. What goes
  // when the limit is reached is what lies farthest from the stretch wished for, so a click back nearby still finds its
  // frames; the stretch wished for itself is never given up.
  test("beyond the memory limit the frames farthest from the stretch wished for go first, never frames inside it", async () => {
    const range = (from: number, to: number) => Array.from({ length: to - from }, (_unused, at) => from + at);
    const idle = (pictures: PictureFrames) =>
      vi.waitFor(() => expect(pictures.runs().some((run) => run.running)).toBe(false), { timeout: 15000 });

    // What one stretch of 2 s weighs, measured without a limit.
    const measuring = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 2 });
    measuring.want(recording, 2);
    await madeFrame(measuring, recording, 119);
    await idle(measuring);
    const stretchBytes = measuring.heldBytes();
    measuring.stop();

    const budgetBytes = Math.round(stretchBytes * 1.5);
    const pictures = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 2, budgetBytes });
    try {
      // Frames 60–119 first, then frames 300–359.
      pictures.want(recording, 2);
      await madeFrame(pictures, recording, 119);
      await idle(pictures);
      pictures.want(recording, 10);
      await madeFrame(pictures, recording, 359);
      await idle(pictures);

      expect(pictures.heldBytes()).toBeLessThanOrEqual(budgetBytes);
      expect(pictures.frames(recording, range(300, 360)).every((jpeg) => jpeg !== null)).toBe(true);
      // Of the first stretch some is left, and what is left is its end: the frames nearest to 10 s.
      const left = range(60, 120).filter((index) => pictures.frames(recording, [index])[0] !== null);
      expect(left.length).toBeGreaterThan(0);
      expect(left).toEqual(range(120 - left.length, 120));
    } finally {
      pictures.stop();
    }
  }, 60000);

  // What a Recording promises is not always what it holds: the last frames can be missing. A Playhead at the very end
  // then asks for frames that never come, and the prototype answered with three empty runs and a picture left standing.
  test("frames the Recording promises but does not hold stand in as its last frame, and are not asked for twice", async () => {
    const promisingMore = { ...recording, durationFrames: recording.durationFrames + 10 };
    const pictures = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 1 });
    try {
      // 19.9 s is frame 597; the file holds up to 599, the Recording promises ten more.
      pictures.want(promisingMore, 19.9);

      expect(whichFrame(await madeFrame(pictures, promisingMore, 605), recording.path, [598, 599])).toBe(599);
      await vi.waitFor(() => expect(pictures.runs().some((run) => run.running)).toBe(false), { timeout: 15000 });
      expect(pictures.runs()).toHaveLength(1);
    } finally {
      pictures.stop();
    }
  }, 60000);

  // A Recording ffmpeg cannot read — moved away since it was opened, say — has to say so. Left to itself the window
  // shows an empty picture and nothing else.
  test("a Recording ffmpeg makes no frames of is reported with ffmpeg's own reason", async () => {
    const gone = { ...recording, path: join(workDir, "gone.mp4") };
    const pictures = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 1 });
    try {
      pictures.want(gone, 3);

      const reason = await vi.waitFor(
        () => {
          const failure = pictures.failure(gone);
          if (!failure) throw new Error("nothing reported yet");
          return failure;
        },
        { timeout: 20000, interval: 50 },
      );
      expect(reason).toMatch(/no such file/i);
      expect(pictures.frames(gone, [90])).toEqual([null]);
      // Another Recording, whose frames ffmpeg makes, is not tarred with that brush.
      pictures.want(recording, 3);
      expect(pictures.failure(recording)).toBeNull();
    } finally {
      pictures.stop();
    }
  }, 60000);

  // The owner took 60 frames a second as enough. Above that the picture takes every second or third frame, so three
  // minutes of it need no more memory — and picture frame 30 of a 120 fps Recording is its frame 60.
  test("a Recording above 60 frames a second has its picture made of every second frame", async () => {
    const path = join(workDir, "fast-frames.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", "color=black:size=160x90:rate=120:duration=2,format=yuv420p,geq=lum='16+4*mod(N\\,50)':cb=128:cr=128"],
      ...["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"],
      ...["-map", "0:v", "-map", "1:a", "-t", "2"],
      ...["-c:v", "libopenh264", "-g", "240", "-b:v", "2M", "-c:a", "aac", path],
    ]);
    const fast = await probeRecording(path, vendor("ffprobe.exe"));
    const pictures = newPictureFrames(vendor("ffmpeg.exe"), { height: HEIGHT, wantSeconds: 1 });
    try {
      pictures.want(fast, 0.5);

      expect(whichFrame(await madeFrame(pictures, fast, 30), path, [59, 60, 61])).toBe(60);
      expect(whichFrame(await madeFrame(pictures, fast, 31), path, [61, 62, 63])).toBe(62);
    } finally {
      pictures.stop();
    }
  }, 60000);
});
