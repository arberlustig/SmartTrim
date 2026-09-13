import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { exportFcp7Xml, type RecordingInfo } from "../export/exportFcp7Xml";
import { buildVoiceRecording } from "../testing/voiceRecording";
import { openFile } from "./openFile";
import { runCut, type CutResult } from "./runCut";
import { newTabStore } from "./tabStore";

// These tests run the real binaries in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));
const tools = { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") };
const toolsReady = async () => tools;

/** A probed Recording at `path`, for tests that never touch the file. */
function probed(path: string): RecordingInfo {
  return {
    path,
    frameRate: { numerator: 30, denominator: 1 },
    width: 320,
    height: 240,
    durationFrames: 362,
    sourceTracks: [{ channelCount: 2, sampleRate: 48000, bitDepth: 16, durationFrames: 362 }],
  };
}

/** What the window asks for when it cuts a Recording by its only SourceTrack, on the owner's settings. */
const cutRequest = (recordingPath: string) => ({
  recordingPath,
  voiceSourceTracks: [0],
  decideBy: { kind: "loudness", thresholdDbfs: -40 } as const,
  marginSeconds: 0.05,
  minimumDeadZoneSeconds: 0.25,
});

// Every Tab keeps its own Recording, its own read SourceTracks and its own cut; nothing passes between them (ADR-0025).
describe("tabStore", () => {
  let workDir: string;
  /** The whole voice with its closing silence, 12 s. */
  let longPath: string;
  /** The same voice cut off after 4 s: its SourceTrack 1 sits at the same position and sounds different. */
  let shortPath: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-tabs-"));
    longPath = join(workDir, "long.mp4");
    shortPath = join(workDir, "short.mp4");
    buildVoiceRecording(longPath, 362);
    buildVoiceRecording(shortPath, 120);
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("a Recording opened again, however its path is spelled, or through its project, is the Tab it already has", () => {
    const store = newTabStore(toolsReady);
    const first = store.open({ kind: "recording", recording: probed(String.raw`C:\Aufnahmen\long-recording.mp4`) });

    const again = store.open({ kind: "recording", recording: probed("c:/aufnahmen/LONG-RECORDING.MP4") });
    const itsProject = store.open({
      kind: "project",
      project: {} as never,
      cut: { recording: probed(String.raw`C:\Aufnahmen\long-recording.mp4`) } as CutResult,
    });
    const other = store.open({ kind: "recording", recording: probed(String.raw`C:\Aufnahmen\ww29.mp4`) });

    expect(first.alreadyOpen).toBe(false);
    expect([again, itsProject]).toEqual([
      { tabId: first.tabId, alreadyOpen: true },
      { tabId: first.tabId, alreadyOpen: true },
    ]);
    expect(other.alreadyOpen).toBe(false);
    expect(other.tabId).not.toBe(first.tabId);
  });

  // Positions repeat from one Recording to the next: SourceTrack 1 of one capture is not SourceTrack 1 of another.
  test("each Tab reads and cuts its own Recording, even where another Tab has read the same SourceTrack", async () => {
    const store = newTabStore(toolsReady);
    const long = store.open(await openFile(longPath, tools.ffprobe));
    const short = store.open(await openFile(shortPath, tools.ffprobe));

    await store.readSourceTracks(long.tabId, [0]);
    const shortWaveforms = await store.readSourceTracks(short.tabId, [0]);
    const shortSummary = await store.cut(short.tabId, cutRequest(shortPath));

    // The truth: the short Recording read and cut on its own, with no Tab beside it.
    const alone = newTabStore(toolsReady);
    const onlyShort = alone.open(await openFile(shortPath, tools.ffprobe));
    expect(shortWaveforms).toEqual(await alone.readSourceTracks(onlyShort.tabId, [0]));
    expect(shortSummary).toEqual((await runCut(cutRequest(shortPath), tools)).summary);
  }, 60_000);

  // "Speichern und schließen" asks nothing: the owner found a save dialog one question too many (ADR-0025).
  test("a Tab saves its project beside its Recording without overwriting another file, then back into that same file", async () => {
    const folder = mkdtempSync(join(workDir, "beside-"));
    const recording = join(folder, "Part1.mp4");
    copyFileSync(shortPath, recording);
    const olderProject = join(folder, "Part1.smarttrim");
    writeFileSync(olderProject, "an older project nobody opened");
    const choices = { ...cutRequest(recording), exportSourceTracks: [0] };

    const store = newTabStore(toolsReady);
    const tab = store.open(await openFile(recording, tools.ffprobe));
    await store.cut(tab.tabId, cutRequest(recording));
    const first = await store.saveProject(tab.tabId, choices);
    const second = await store.saveProject(tab.tabId, choices);

    const saved = join(folder, "Part1 (2).smarttrim");
    expect([first, second]).toEqual([saved, saved]);
    expect(readFileSync(olderProject, "utf8")).toBe("an older project nobody opened");
    // Opened from that project in a later session, the Tab saves back into it rather than beside it again.
    const later = newTabStore(toolsReady);
    const reopened = later.open({ ...(await openFile(saved, tools.ffprobe)), path: saved });
    expect(await later.saveProject(reopened.tabId, choices)).toBe(saved);
    expect(readdirSync(folder).sort()).toEqual(["Part1 (2).smarttrim", "Part1.mp4", "Part1.smarttrim"]);
  }, 60_000);

  // "Alle Premiere-Dateien speichern" asks nothing: one save dialog per Tab would be ten dialogs for ten Recordings
  // (ADR-0026). It writes the Premiere file only, like the single Tab's "Premiere-Datei speichern".
  test("a Tab saves its Premiere file beside its Recording, never over a file that is already there", async () => {
    const folder = mkdtempSync(join(workDir, "all-"));
    const recording = join(folder, "Part1.mp4");
    copyFileSync(shortPath, recording);
    const someoneElses = join(folder, "Part1.xml");
    writeFileSync(someoneElses, "a Premiere file from another program");

    const store = newTabStore(toolsReady);
    const tab = store.open(await openFile(recording, tools.ffprobe));
    await store.cut(tab.tabId, cutRequest(recording));
    const first = await store.savePremiereBeside(tab.tabId, [0]);
    const second = await store.savePremiereBeside(tab.tabId, [0]);

    expect([first, second]).toEqual([join(folder, "Part1 (2).xml"), join(folder, "Part1 (3).xml")]);
    expect(readFileSync(someoneElses, "utf8")).toBe("a Premiere file from another program");
    // Nothing else is written: no project appears beside the Recording.
    expect(readdirSync(folder).sort()).toEqual(["Part1 (2).xml", "Part1 (3).xml", "Part1.mp4", "Part1.xml"]);
    // The truth: the same Recording cut on its own and exported, with no Tab and no saving by name involved.
    const alone = await runCut(cutRequest(recording), tools);
    expect(readFileSync(first, "utf8")).toBe(exportFcp7Xml(alone.recording, alone.cutPlan, [0]));
  }, 60_000);

  // Closing a Tab while its SourceTracks are still being read is an everyday move: the wrong file was dropped.
  test("a read that finishes after its Tab was closed is refused, and the closed Tab takes no more requests", async () => {
    const store = newTabStore(toolsReady);
    const tab = store.open(await openFile(longPath, tools.ffprobe));

    const reading = store.readSourceTracks(tab.tabId, [0]);
    store.close(tab.tabId);

    await expect(reading).rejects.toThrow(`Tab ${tab.tabId} is closed.`);
    await expect(store.cut(tab.tabId, cutRequest(longPath))).rejects.toThrow(`Tab ${tab.tabId} is closed.`);
    // The Recording is free to open again, in a Tab of its own with nothing read yet.
    const reopened = store.open(await openFile(longPath, tools.ffprobe));
    const decoded: number[] = [];
    await store.readSourceTracks(reopened.tabId, [0], (done) => decoded.push(done));
    expect([reopened.alreadyOpen, decoded]).toEqual([false, [1]]);
  }, 60_000);
});
