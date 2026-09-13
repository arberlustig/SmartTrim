import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import { probeRecording } from "../probe/probeRecording";
import { readExcerpt, type Excerpt } from "./readExcerpt";

// These tests run the real binaries in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));

/** The frequency of one Channel between two moments of an Excerpt, counted from zero crossings; 0 for silence. */
function hertzOf(excerpt: Excerpt, channel: number, fromSeconds: number, toSeconds: number): number {
  const { samples, sampleRate, channelCount } = excerpt;
  const first = Math.round(fromSeconds * sampleRate);
  const last = Math.round(toSeconds * sampleRate);
  let crossings = 0;
  let loudest = 0;
  for (let frame = first; frame < last; frame++) {
    const sample = samples[frame * channelCount + channel] ?? 0;
    const before = samples[(frame - 1) * channelCount + channel] ?? 0;
    loudest = Math.max(loudest, Math.abs(sample));
    if (frame > first && sample < 0 !== before < 0) crossings++;
  }
  return loudest === 0 ? 0 : crossings / 2 / (toSeconds - fromSeconds);
}

/** The same, rounded to 10 Hz and readable in a failing test. */
function pitchOf(excerpt: Excerpt, channel: number, fromSeconds: number, toSeconds: number): string {
  const hertz = hertzOf(excerpt, channel, fromSeconds, toSeconds);
  return hertz === 0 ? "silence" : `${Math.round(hertz / 10) * 10} Hz`;
}

describe("readExcerpt", () => {
  let workDir: string;
  let recording: RecordingInfo;

  // Built like an OBS Recording with two stereo AAC SourceTracks that a mix-up cannot pass:
  // SourceTrack 1 at 48 kHz plays 440 Hz on the left Channel and 1000 Hz on the right;
  // SourceTrack 2 at 44.1 kHz plays 600 Hz on both Channels until 3 s, then 1500 Hz.
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-excerpt-"));
    const path = join(workDir, "two-sourcetracks.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6"],
      ...["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=6"],
      ...["-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*if(lt(t,3),600,1500)*t)':s=44100:d=6"],
      ...["-filter_complex", "[1:a][2:a]join=inputs=2:channel_layout=stereo[a1];[3:a]aformat=channel_layouts=stereo[a2]"],
      ...["-map", "0:v", "-map", "[a1]", "-map", "[a2]", "-frames:v", "180"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-b:a", "128k", path],
    ]);
    recording = await probeRecording(path, vendor("ffprobe.exe"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("the chosen SourceTrack comes back with both Channels apart, at its own sample rate, as long as asked", async () => {
    const excerpt = await readExcerpt(recording, 0, 1, 3, vendor("ffmpeg.exe"));

    expect({
      fromSeconds: excerpt.fromSeconds,
      sampleRate: excerpt.sampleRate,
      channelCount: excerpt.channelCount,
      seconds: excerpt.samples.length / excerpt.channelCount / excerpt.sampleRate,
      left: pitchOf(excerpt, 0, 0.2, 1.8),
      right: pitchOf(excerpt, 1, 0.2, 1.8),
    }).toEqual({ fromSeconds: 1, sampleRate: 48000, channelCount: 2, seconds: 2, left: "440 Hz", right: "1000 Hz" });
  });

  // Playback exists to judge the Joins, so an Excerpt that starts even a few frames late would put every Join in
  // the wrong place. SourceTrack 2 changes pitch at exactly 3 s; read from 2.5 s, the change belongs at 0.5 s.
  test("starts at the moment asked for, on a SourceTrack with another sample rate", async () => {
    const excerpt = await readExcerpt(recording, 1, 2.5, 3.5, vendor("ffmpeg.exe"));

    expect({
      sampleRate: excerpt.sampleRate,
      seconds: excerpt.samples.length / excerpt.channelCount / excerpt.sampleRate,
      before: pitchOf(excerpt, 0, 0.05, 0.45),
      after: pitchOf(excerpt, 0, 0.55, 0.95),
    }).toEqual({ sampleRate: 44100, seconds: 1, before: "600 Hz", after: "1500 Hz" });
    // The tenth of a second on either side of 0.5 s: landing 10 ms off would mix the other pitch into it by a tenth.
    expect(hertzOf(excerpt, 0, 0.39, 0.49)).toBeGreaterThan(560);
    expect(hertzOf(excerpt, 0, 0.39, 0.49)).toBeLessThan(640);
    expect(hertzOf(excerpt, 0, 0.51, 0.61)).toBeGreaterThan(1410);
    expect(hertzOf(excerpt, 0, 0.51, 0.61)).toBeLessThan(1590);
  });

  // The owner set the limit at three minutes: 33 MB of stereo at 48 kHz, and a window asking for more has lost track
  // of what it shows. Each refusal comes before ffmpeg is started, which is why an ffmpeg that does not exist is
  // handed in: reaching it would fail with a different message.
  test("refuses more than three minutes, a stretch of no length and a SourceTrack the Recording lacks", async () => {
    const noFfmpeg = join(workDir, "no-ffmpeg.exe");

    await expect(readExcerpt(recording, 0, 10, 190.01, noFfmpeg)).rejects.toThrow(/three minutes/);
    await expect(readExcerpt(recording, 0, 2, 2, noFfmpeg)).rejects.toThrow(/no length/);
    await expect(readExcerpt(recording, 5, 0, 1, noFfmpeg)).rejects.toThrow(/SourceTrack 6/);
    // Exactly three minutes is allowed, so this one gets as far as starting ffmpeg.
    await expect(readExcerpt(recording, 0, 10, 190, noFfmpeg)).rejects.toThrow(/ENOENT/);
  });
});
