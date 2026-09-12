import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCut } from "../app/runCut";
import { openTrimProject, saveTrimProject, trimProjectOf } from "./openTrimProject";
import { trimProjectText } from "./trimProject";

const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));
const tools = { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") };
const speechFixture = fileURLToPath(new URL("../../fixtures/speech/synthetic-speech-16k.pcm", import.meta.url));

const FRAMES_PER_SECOND = 30;

/** Builds a Recording of `frames` frames with the synthesized voice as its only SourceTrack. */
function buildRecording(path: string, frames: number): void {
  execFileSync(vendor("ffmpeg.exe"), [
    ...["-v", "error", "-y"],
    ...["-f", "lavfi", "-i", `testsrc2=size=320x240:rate=${FRAMES_PER_SECOND}`],
    ...["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", speechFixture],
    ...["-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=stereo[voice]"],
    ...["-map", "0:v", "-map", "[voice]", "-frames:v", String(frames)],
    ...["-c:v", "mpeg4", "-c:a", "aac", "-b:a", "128k", path],
  ]);
}

describe("openTrimProject", () => {
  let workDir: string;
  let recordingPath: string;
  const request = () => ({
    recordingPath,
    voiceSourceTracks: [0],
    decideBy: { kind: "loudness", thresholdDbfs: -40 } as const,
    marginSeconds: 0.05,
    minimumDeadZoneSeconds: 0.25,
  });

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-project-"));
    recordingPath = join(workDir, "voice.mp4");
    buildRecording(recordingPath, 362);
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // The point of saving: tomorrow the same cut is there again, without the Recording being read for it.
  test("a saved session reopens as the cut it was saved from", async () => {
    const cut = await runCut(request(), tools);
    const saved = trimProjectText(trimProjectOf(cut, { ...request(), exportSourceTracks: [0] }));

    const reopened = await openTrimProject(saved, tools.ffprobe);

    expect(reopened.cut.cutPlan).toEqual(cut.cutPlan);
    expect(reopened.cut.summary).toEqual(cut.summary);
    expect(reopened.project.listenTo).toEqual([0]);
    expect(reopened.project.decideBy).toEqual({ kind: "loudness", thresholdDbfs: -40 });
    // The audio itself was not saved, so another threshold would have to read the Recording again.
    expect(reopened.cut.listened).toEqual([]);
  }, 60_000);

  // Every position in a CutPlan is a frame of one particular Recording. Against a different file of a different
  // length they point somewhere else, or past its end.
  test("a Recording that is no longer the one the project was cut from is refused", async () => {
    const cut = await runCut(request(), tools);
    const saved = trimProjectText(trimProjectOf(cut, { ...request(), exportSourceTracks: [0] }));

    // Half as long: what happens when a Recording is re-exported or trimmed after the session. Written next to the
    // original rather than over it, so the other tests still have theirs.
    const shorterPath = join(workDir, "shorter.mp4");
    buildRecording(shorterPath, 181);
    const shorter = saved.replace(JSON.stringify(recordingPath).slice(1, -1), JSON.stringify(shorterPath).slice(1, -1));

    await expect(openTrimProject(shorter, tools.ffprobe)).rejects.toThrow(/no longer the Recording/);
  }, 60_000);

  test("a Recording that has moved away is refused with the path it was looked for at", async () => {
    const cut = await runCut(request(), tools);
    const saved = trimProjectText(trimProjectOf(cut, { ...request(), exportSourceTracks: [0] }));
    const gone = saved.replace(JSON.stringify(recordingPath).slice(1, -1), "Z:/gone/voice.mp4");

    await expect(openTrimProject(gone, tools.ffprobe)).rejects.toThrow("voice.mp4");
  }, 60_000);

  // The whole way round: cut, write a file, read that file back, cut plan unchanged.
  test("a project written to disk opens again from disk", async () => {
    const cut = await runCut(request(), tools);
    const projectPath = join(workDir, "voice.smarttrim");

    await saveTrimProject(projectPath, trimProjectOf(cut, { ...request(), exportSourceTracks: [0] }));
    const reopened = await openTrimProject(readFileSync(projectPath, "utf8"), tools.ffprobe);

    expect(reopened.cut.cutPlan).toEqual(cut.cutPlan);
  }, 60_000);

  test("saving where the folder does not exist fails clearly", async () => {
    const cut = await runCut(request(), tools);
    const destination = join(workDir, "unplugged", "voice.smarttrim");

    await expect(
      saveTrimProject(destination, trimProjectOf(cut, { ...request(), exportSourceTracks: [0] })),
    ).rejects.toThrow(`Could not write the SmartTrim project to ${destination}`);
  }, 60_000);
});
