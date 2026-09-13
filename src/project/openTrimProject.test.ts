import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCut } from "../app/runCut";
import { buildVoiceRecording } from "../testing/voiceRecording";
import { openTrimProject, saveTrimProject, trimProjectOf } from "./openTrimProject";
import { trimProjectText } from "./trimProject";

const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));
const tools = { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") };

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
    buildVoiceRecording(recordingPath, 362);
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

  // A held stretch is the user's own decision about this Recording (ADR-0023). Reopened without it, the plan would
  // quietly cut away the second of silence the user had marked to keep.
  test("a session saved with a held stretch reopens with that stretch still kept", async () => {
    const lockedRanges = [{ startSeconds: 10.5, endSeconds: 11.5 }];
    const cut = await runCut({ ...request(), lockedRanges }, tools);
    const saved = trimProjectText(trimProjectOf(cut, { ...request(), lockedRanges, exportSourceTracks: [0] }));

    const reopened = await openTrimProject(saved, tools.ffprobe);

    expect(reopened.project.lockedRanges).toEqual(lockedRanges);
    expect(reopened.cut.cutPlan).toEqual(cut.cutPlan);
    // 30 fps: the held second is frame 315 to frame 345, exactly as marked.
    expect(reopened.cut.cutPlan.map(({ recordingIn, recordingOut }) => [recordingIn, recordingOut])).toContainEqual([315, 345]);
  }, 60_000);

  // Every position in a CutPlan is a frame of one particular Recording. Against a different file of a different
  // length they point somewhere else, or past its end.
  test("a Recording that is no longer the one the project was cut from is refused", async () => {
    const cut = await runCut(request(), tools);
    const saved = trimProjectText(trimProjectOf(cut, { ...request(), exportSourceTracks: [0] }));

    // Half as long: what happens when a Recording is re-exported or trimmed after the session. Written next to the
    // original rather than over it, so the other tests still have theirs.
    const shorterPath = join(workDir, "shorter.mp4");
    buildVoiceRecording(shorterPath, 181);
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
