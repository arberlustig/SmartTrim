import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import { probeRecording } from "../probe/probeRecording";
import type { MonoPcm } from "../speech/detectSpeech";
import { decodeSourceTracks } from "./decodeSourceTracks";

// These tests run the real binaries in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));

/** What decoded audio sounds like: its rate, its length, and its pitch counted from zero crossings, or silence. */
function describePcm({ sampleRate, samples }: MonoPcm) {
  let crossings = 0;
  let loudest = 0;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index] ?? 0;
    loudest = Math.max(loudest, Math.abs(sample));
    if (index > 0 && sample < 0 !== (samples[index - 1] ?? 0) < 0) crossings++;
  }
  const seconds = samples.length / sampleRate;
  const pitch = Math.round(crossings / 2 / seconds / 10) * 10;
  return { sampleRate, seconds, sound: loudest === 0 ? "silence" : `${pitch} Hz` };
}

describe("decodeSourceTracks", () => {
  let workDir: string;
  let recording: RecordingInfo;

  // Built like an OBS Recording, with AAC SourceTracks that differ in pitch and length so that a mixed-up SourceTrack
  // cannot pass: 440 Hz for 2 s, silence for 2 s, and 1000 Hz on the left Channel only for 1.2 s.
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-decode-"));
    const path = join(workDir, "three-sourcetracks.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"],
      ...["-f", "lavfi", "-t", "2", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"],
      ...["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=1.2"],
      ...["-filter_complex", "[1:a]aformat=channel_layouts=stereo[a1];[3:a]pan=stereo|c0=c0|c1=0*c0[a3]"],
      ...["-map", "0:v", "-map", "[a1]", "-map", "2:a", "-map", "[a3]", "-frames:v", "90"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-b:a", "128k", path],
    ]);
    recording = await probeRecording(path, vendor("ffprobe.exe"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("each requested SourceTrack comes back as 16 kHz mono with its own length and sound, in the order asked for", async () => {
    const decoded = await decodeSourceTracks(recording, [2, 0, 1], vendor("ffmpeg.exe"));

    expect(decoded.map(describePcm)).toEqual([
      { sampleRate: 16000, seconds: 1.2, sound: "1000 Hz" },
      { sampleRate: 16000, seconds: 2, sound: "440 Hz" },
      { sampleRate: 16000, seconds: 2, sound: "silence" },
    ]);
  });

  test("a SourceTrack ffmpeg cannot decode is reported with ffmpeg's reason", async () => {
    const missing = { ...recording, path: join(workDir, "missing.mp4") };

    await expect(decodeSourceTracks(missing, [0], vendor("ffmpeg.exe"))).rejects.toThrow(
      /^ffmpeg could not decode SourceTrack 1 of .+missing\.mp4: [\s\S]*No such file or directory/,
    );
  });
});
