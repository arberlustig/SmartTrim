import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { probeRecording } from "../probe/probeRecording";
import { scanSourceTracks } from "./scanSourceTracks";

// The real binaries in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));
const speechFixture = fileURLToPath(new URL("../../fixtures/speech/synthetic-speech-16k.pcm", import.meta.url));

const FRAMES_PER_SECOND = 30;

describe("scanSourceTracks", () => {
  let workDir: string;
  let recordingPath: string;

  /**
   * A Recording built like an OBS capture with four SourceTracks: one never routed anywhere, one carrying sound
   * from start to end, the synthesized voice, and one that only makes a sound between 5 s and 7 s — the case that
   * matters, because a real Recording had a SourceTrack which was silent in two slices out of five.
   */
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-scan-"));
    recordingPath = join(workDir, "four-tracks.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", `testsrc2=size=320x240:rate=${FRAMES_PER_SECOND}`],
      ...["-f", "lavfi", "-i", "anullsrc=sample_rate=48000:channel_layout=stereo"],
      ...["-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.1:seed=7:sample_rate=48000:duration=12.065"],
      ...["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", speechFixture],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"],
      ...[
        "-filter_complex",
        [
          "[2:a]aformat=channel_layouts=stereo[noise]",
          "[3:a]aresample=48000,aformat=channel_layouts=stereo[voice]",
          "[4:a]adelay=5000|5000,apad,atrim=0:12.065,aformat=channel_layouts=stereo[beep]",
        ].join(";"),
      ],
      ...["-map", "0:v", "-map", "1:a", "-map", "[noise]", "-map", "[voice]", "-map", "[beep]"],
      ...["-frames:v", "362", "-shortest"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-b:a", "128k", recordingPath],
    ]);
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("tells the SourceTracks that carry sound from the one that was never routed anywhere", async () => {
    const recording = await probeRecording(recordingPath, vendor("ffprobe.exe"));
    expect(recording.sourceTracks).toHaveLength(4);

    const scan = await scanSourceTracks(recording, vendor("ffmpeg.exe"), { slices: 3, sliceSeconds: 2 });

    expect(scan.map((sourceTrack) => sourceTrack.carriesSound)).toEqual([false, true, true, true]);
    // Nothing was ever routed to the first SourceTrack, so every slice of it is digital silence.
    expect(scan[0]?.peakDbfs).toBe(-Infinity);
    expect(scan[0]?.slicesWithSound).toBe(0);
    // The steady one is in every slice; the beep only in the middle one, and that is enough to keep it visible.
    expect(scan[1]?.slicesWithSound).toBe(3);
    expect(scan[3]?.slicesWithSound).toBe(1);
    expect(scan.map((sourceTrack) => sourceTrack.sliceCount)).toEqual([3, 3, 3, 3]);
    // Pink noise at amplitude 0.1 peaks around -20 dBFS, far above anything a silent track could reach.
    expect(scan[1]?.peakDbfs).toBeGreaterThan(-30);
  }, 60_000);
});
