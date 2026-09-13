import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { saveTrimProject, trimProjectOf } from "../project/openTrimProject";
import { buildVoiceRecording } from "../testing/voiceRecording";
import { openFile, openFiles } from "./openFile";
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

/** A cut by the voice Recording's only SourceTrack, on the owner's settings. */
const voiceRequest = {
  voiceSourceTracks: [0],
  decideBy: { kind: "loudness", thresholdDbfs: -40 } as const,
  marginSeconds: 0.05,
  minimumDeadZoneSeconds: 0.25,
};

// Several files dropped at once, or a whole folder, each become a tab of their own (ADR-0025).
describe("openFiles", () => {
  let workDir: string;
  let recordingPath: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-open-many-"));
    recordingPath = join(workDir, "voice.mp4");
    // Long enough to hold the whole voice, so a project can be cut from it.
    buildVoiceRecording(recordingPath, 362);
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("a folder opens the files directly inside it in natural order, and names the ones it could not open", async () => {
    const folder = join(workDir, "stream");
    mkdirSync(join(folder, "older"), { recursive: true });
    copyFileSync(recordingPath, join(folder, "Part10.mp4"));
    copyFileSync(recordingPath, join(folder, "Part2.mp4"));
    writeFileSync(join(folder, "notiz.txt"), "nichts zu schneiden");
    copyFileSync(recordingPath, join(folder, "older", "Part1.mp4"));

    const result = await openFiles([folder], tools.ffprobe);

    expect(result.opened.map((file) => [file.kind, file.path])).toEqual([
      ["recording", join(folder, "Part2.mp4")],
      ["recording", join(folder, "Part10.mp4")],
    ]);
    // What went wrong, as a kind the window can word, and the core of ffprobe's own report — without the path it
    // wraps that report in twice.
    expect(result.refused).toEqual([
      { path: join(folder, "notiz.txt"), kind: "notARecording", detail: "Invalid data found when processing input" },
    ]);
  }, 60_000);

  // The project holds the work done on its Recording; opening the bare Recording beside it would hide that work.
  test("a Recording and its project side by side open once, as the project, where the Recording stood", async () => {
    const folder = join(workDir, "with-project");
    mkdirSync(folder);
    copyFileSync(recordingPath, join(folder, "Part1.mp4"));
    copyFileSync(recordingPath, join(folder, "Part2.mp4"));
    const request = {
      recordingPath: join(folder, "Part2.mp4"),
      voiceSourceTracks: [0],
      decideBy: { kind: "loudness", thresholdDbfs: -40 } as const,
      marginSeconds: 0.05,
      minimumDeadZoneSeconds: 0.25,
    };
    const cut = await runCut(request, tools);
    await saveTrimProject(join(folder, "Part2.smarttrim"), trimProjectOf(cut, { ...request, exportSourceTracks: [0] }));
    copyFileSync(recordingPath, join(folder, "Part3.mp4"));

    const result = await openFiles([folder], tools.ffprobe);

    expect(result.opened.map((file) => [file.kind, file.path])).toEqual([
      ["recording", join(folder, "Part1.mp4")],
      ["project", join(folder, "Part2.smarttrim")],
      ["recording", join(folder, "Part3.mp4")],
    ]);
    expect(result.refused).toEqual([]);
  }, 60_000);

  // Recordings get moved and re-exported between sessions; the window has to say which of those happened.
  test("a project says whether its Recording is gone, changed, or the project itself broken; an MKV says it cannot be cut", async () => {
    const folder = join(workDir, "refusals");
    mkdirSync(folder);
    const saveProjectOf = async (name: string) => {
      const recording = join(folder, `${name}.mp4`);
      copyFileSync(recordingPath, recording);
      const request = { ...voiceRequest, recordingPath: recording };
      const cut = await runCut(request, tools);
      const project = join(folder, `${name}.smarttrim`);
      await saveTrimProject(project, trimProjectOf(cut, { ...request, exportSourceTracks: [0] }));
      return { recording, project };
    };
    const gone = await saveProjectOf("gone");
    rmSync(gone.recording);
    const changed = await saveProjectOf("changed");
    buildVoiceRecording(changed.recording, 300);
    const broken = join(folder, "broken.smarttrim");
    writeFileSync(broken, "{ kein Projekt");
    const mkv = join(folder, "voice.mkv");
    execFileSync(tools.ffmpeg, ["-v", "error", "-y", "-i", recordingPath, "-c", "copy", mkv]);

    const result = await openFiles([gone.project, changed.project, broken, mkv], tools.ffprobe);

    expect(result.refused.map(({ kind }) => kind)).toEqual([
      "projectRecordingMissing",
      "projectRecordingChanged",
      "notAProject",
      "cannotCut",
    ]);
    // Where the Recording was looked for is the one path worth showing: it is what the user has to go and find.
    expect(result.refused[0]?.detail).toBe(gone.recording);
    expect(result.refused[2]?.detail).toBe("This file is not a SmartTrim project.");
    for (const { detail } of result.refused.slice(1)) {
      expect(detail).not.toBe("");
      expect(detail).not.toContain(folder);
    }
  }, 60_000);

  // SmartTrim writes its Premiere files next to the Recordings, so a folder dropped again is full of them. Listed as
  // refusals they would bury the one line that matters; a Premiere file handed over by itself still says why.
  test("Premiere files inside a folder are passed over without a word, one handed over by itself is refused", async () => {
    const folder = join(workDir, "with-premiere-files");
    mkdirSync(folder);
    copyFileSync(recordingPath, join(folder, "Part1.mp4"));
    writeFileSync(join(folder, "Part1.xml"), "<xmeml/>");
    const single = join(workDir, "alone.XML");
    writeFileSync(single, "<xmeml/>");

    const result = await openFiles([folder, single], tools.ffprobe);

    expect(result.opened.map((file) => file.path)).toEqual([join(folder, "Part1.mp4")]);
    expect(result.refused.map((file) => file.path)).toEqual([single]);
  }, 60_000);
});
