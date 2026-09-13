import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { saveTrimProject, trimProjectOf } from "../project/openTrimProject";
import { buildVoiceRecording } from "../testing/voiceRecording";
import { openFile } from "./openFile";
import { runCut } from "./runCut";

// These tests run the real binaries in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));
const tools = { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") };

// A file dropped on the window arrives as nothing but a path; what it is decides how it opens.
describe("openFile", () => {
  let workDir: string;
  let recordingPath: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-open-"));
    recordingPath = join(workDir, "voice.mp4");
    // 362 frames at 30 fps, one stereo SourceTrack: the values the first test expects.
    buildVoiceRecording(recordingPath, 362);
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("a video opens as a Recording", async () => {
    const opened = await openFile(recordingPath, tools.ffprobe);

    expect(opened.kind).toBe("recording");
    if (opened.kind !== "recording") return;
    expect({
      path: opened.recording.path,
      frameRate: opened.recording.frameRate,
      durationFrames: opened.recording.durationFrames,
      channelCounts: opened.recording.sourceTracks.map((sourceTrack) => sourceTrack.channelCount),
    }).toEqual({ path: recordingPath, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 362, channelCounts: [2] });
  }, 60_000);

  // Explorer shows the extension however it was typed, so a project renamed to .SmartTrim is still a project.
  test("a SmartTrim project opens as the cut it was saved from, whatever case its extension is in", async () => {
    const request = {
      recordingPath,
      voiceSourceTracks: [0],
      decideBy: { kind: "loudness", thresholdDbfs: -40 } as const,
      marginSeconds: 0.05,
      minimumDeadZoneSeconds: 0.25,
    };
    const cut = await runCut(request, tools);
    const projectPath = join(workDir, "voice.SmartTrim");
    await saveTrimProject(projectPath, trimProjectOf(cut, { ...request, exportSourceTracks: [0] }));

    const opened = await openFile(projectPath, tools.ffprobe);

    expect(opened.kind).toBe("project");
    if (opened.kind !== "project") return;
    expect(opened.project.listenTo).toEqual([0]);
    expect(opened.cut.cutPlan).toEqual(cut.cutPlan);
  }, 60_000);

  // Handed to ffprobe, a folder comes back as an unreadable file with a reason that says nothing about folders.
  test("a folder is refused as a folder", async () => {
    await expect(openFile(workDir, tools.ffprobe)).rejects.toThrow(`${workDir} is a folder, not a file.`);
  }, 60_000);
});
