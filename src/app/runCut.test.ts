import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CutPlan } from "../cutting/planCuts";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import { redecideCut, replanCut, runCut, saveCutPlan, summariseCutPlan } from "./runCut";

// The real binaries in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));
const tools = { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") };

const speechFixture = (name: string) => fileURLToPath(new URL(`../../fixtures/speech/${name}`, import.meta.url));
/** Where the synthesized voice speaks, measured from its own level by bench/make_speech_fixture.ts. */
const fixtureLayout = (
  JSON.parse(readFileSync(speechFixture("synthetic-speech-16k.json"), "utf8")) as {
    layout: { kind: string; startSeconds: number; endSeconds: number }[];
  }
).layout;
const phrases = fixtureLayout.filter((piece) => piece.kind === "speech");

/** A probed Recording of `durationFrames` at 60 fps with one stereo SourceTrack. */
function probed(durationFrames: number): RecordingInfo {
  return {
    path: String.raw`C:\Aufnahmen\long-recording.mp4`,
    frameRate: { numerator: 60, denominator: 1 },
    width: 1920,
    height: 1080,
    durationFrames,
    sourceTracks: [{ channelCount: 2, sampleRate: 48000, bitDepth: 16, durationFrames }],
  };
}

describe("summariseCutPlan", () => {
  // What the window reports after cutting. 600 frames at 60 fps is a 10 s Recording; the two KeepSegments hold
  // 60 and 120 frames, so 3 s survive and 7 s of it are gone.
  test("counts the kept and the removed time of a plan", () => {
    const cutPlan: CutPlan = [
      { recordingIn: 120, recordingOut: 180, timelineStart: 0, timelineEnd: 60 },
      { recordingIn: 300, recordingOut: 420, timelineStart: 60, timelineEnd: 180 },
    ];

    expect(summariseCutPlan(probed(600), cutPlan)).toEqual({
      recordingSeconds: 10,
      keptSeconds: 3,
      removedSeconds: 7,
      removedShare: 0.7,
      keepSegments: 2,
    });
  });
});

describe("runCut", () => {
  const FRAMES_PER_SECOND = 30;
  let workDir: string;
  let recordingPath: string;

  // A Recording the way the window gets one: 12 s of video at 30 fps with the synthesized voice as its only stereo
  // SourceTrack, so the whole job from probing to the summary runs on a real file.
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-runcut-"));
    recordingPath = join(workDir, "voice.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", `testsrc2=size=320x240:rate=${FRAMES_PER_SECOND}`],
      ...["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", speechFixture("synthetic-speech-16k.pcm")],
      ...["-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=stereo[voice]"],
      ...["-map", "0:v", "-map", "[voice]", "-frames:v", "362"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-b:a", "128k", recordingPath],
    ]);
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // The settings behind the window's own defaults (ADR-0003). Both phrases have to survive whole, the 2 s of
  // silence at the end has to go, and the summary has to describe that same plan.
  test("cutting a Recording keeps every phrase and reports what it removed", async () => {
    const { recording, cutPlan, summary } = await runCut(
      {
        recordingPath,
        voiceSourceTracks: [0],
        decideBy: { kind: "loudness", thresholdDbfs: -40 },
        marginSeconds: 0.05,
        minimumDeadZoneSeconds: 0.25,
      },
      tools,
    );

    expect(recording.frameRate).toEqual({ numerator: FRAMES_PER_SECOND, denominator: 1 });
    const keptSeconds = cutPlan.map((segment) => ({
      from: segment.recordingIn / FRAMES_PER_SECOND,
      to: segment.recordingOut / FRAMES_PER_SECOND,
    }));
    // A threshold clips the quiet tail of a word, which is what it costs (ADR-0003) — but no phrase may lose more
    // than 0.1 s of itself, or the cut would be audible as a swallowed word.
    for (const phrase of phrases) {
      const kept = keptSeconds.reduce(
        (total, { from, to }) => total + Math.max(0, Math.min(to, phrase.endSeconds) - Math.max(from, phrase.startSeconds)),
        0,
      );
      expect(kept).toBeGreaterThanOrEqual(phrase.endSeconds - phrase.startSeconds - 0.1);
    }
    // Nothing is kept in the closing silence, which starts at 10.065 s.
    expect(keptSeconds.every(({ from }) => from < 10.065)).toBe(true);

    expect(summary.keepSegments).toBe(cutPlan.length);
    expect(summary.recordingSeconds).toBeCloseTo(362 / FRAMES_PER_SECOND, 2);
    expect(summary.removedSeconds).toBeGreaterThan(1.9);
    expect(summary.keptSeconds + summary.removedSeconds).toBeCloseTo(summary.recordingSeconds, 2);
  }, 60_000);

  // ADR-0004 promises this one: the decoded audio stays in memory, so moving the threshold decides again from
  // memory instead of touching the file. Compared against the expensive path, like the replan above.
  test("deciding again at another threshold gives exactly what reading the Recording again would give", async () => {
    const settings = { marginSeconds: 0.05, minimumDeadZoneSeconds: 0.25 };
    const listened = { recordingPath, voiceSourceTracks: [0] };

    const cut = await runCut({ ...listened, ...settings, decideBy: { kind: "loudness", thresholdDbfs: -40 } }, tools);
    const quieter = redecideCut(cut, -50, settings);
    const readAgain = await runCut(
      { ...listened, ...settings, decideBy: { kind: "loudness", thresholdDbfs: -50 } },
      tools,
    );

    expect(quieter.cutPlan).toEqual(readAgain.cutPlan);
    expect(quieter.summary).toEqual(readAgain.summary);
    // A lower threshold counts more as worth keeping, or the comparison would hold for the wrong reason.
    expect(quieter.summary.keptSeconds).toBeGreaterThan(cut.summary.keptSeconds);
  }, 60_000);

  // ADR-0004: changing a setting must not mean reading the Recording again. The only way to be sure that replanning
  // is not a cheaper approximation is to compare it against the expensive path on the same Recording.
  test("replanning a finished cut gives exactly what reading the Recording again would give", async () => {
    const decideBy = { kind: "loudness", thresholdDbfs: -40 } as const;
    const listened = { recordingPath, voiceSourceTracks: [0], decideBy };
    const stricter = { marginSeconds: 0.3, minimumDeadZoneSeconds: 1.5 };

    const cut = await runCut({ ...listened, marginSeconds: 0.05, minimumDeadZoneSeconds: 0.25 }, tools);
    const replanned = replanCut(cut, stricter);
    const readAgain = await runCut({ ...listened, ...stricter }, tools);

    expect(replanned.cutPlan).toEqual(readAgain.cutPlan);
    expect(replanned.summary).toEqual(readAgain.summary);
    // The settings have to differ in effect, or the comparison above would hold for the wrong reason.
    expect(replanned.summary.keepSegments).not.toBe(cut.summary.keepSegments);
    // Replanning hands back a new result instead of changing the one on screen.
    expect(cut.summary.keepSegments).toBe(2);
  }, 60_000);
});

describe("saveCutPlan", () => {
  let workDir: string;
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-save-"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // What the user ends up with. The plan holds two KeepSegments, so Premiere must find two clips per track running
  // to frame 180, and the file must point at the Recording itself rather than at anything SmartTrim wrote (ADR-0006).
  test("writes a Premiere file holding the planned cut and pointing at the Recording", async () => {
    const destination = join(workDir, "the long Recording.xml");
    const cutPlan: CutPlan = [
      { recordingIn: 120, recordingOut: 180, timelineStart: 0, timelineEnd: 60 },
      { recordingIn: 300, recordingOut: 420, timelineStart: 60, timelineEnd: 180 },
    ];

    await saveCutPlan(destination, probed(600), cutPlan);

    const xml = new DOMParser().parseFromString(readFileSync(destination, "utf8"), "text/xml");
    const sequence = xml.getElementsByTagName("sequence")[0];
    expect(sequence?.getElementsByTagName("duration")[0]?.textContent).toBe("180");
    // One video track and two TimelineTracks for the stereo SourceTrack, each carrying both KeepSegments.
    for (const track of Array.from(xml.getElementsByTagName("track"))) {
      const clips = Array.from(track.getElementsByTagName("clipitem"));
      expect(clips.map((clip) => clip.getElementsByTagName("in")[0]?.textContent)).toEqual(["120", "300"]);
      expect(clips.map((clip) => clip.getElementsByTagName("end")[0]?.textContent)).toEqual(["60", "180"]);
    }
    expect(Array.from(xml.getElementsByTagName("pathurl")).map((url) => url.textContent)).toContain(
      "file://localhost/C%3a/Aufnahmen/long-recording.mp4",
    );
  });

  // An external drive that is not plugged in, or a folder the user deleted meanwhile. The message has to name the
  // place, and nothing half-written may be left where Premiere would find it.
  test("saving where the folder does not exist fails clearly and leaves no file", async () => {
    const destination = join(workDir, "unplugged", "the long Recording.xml");

    await expect(saveCutPlan(destination, probed(600), [
      { recordingIn: 120, recordingOut: 180, timelineStart: 0, timelineEnd: 60 },
    ])).rejects.toThrow(`Could not write the Premiere file to ${destination}`);

    expect(existsSync(destination)).toBe(false);
  });


  // The owner cuts by the microphone but does not want the same mixdown three times in the sequence (ADR-0014).
  test("only the chosen SourceTracks reach the Premiere file, keeping their own Channel numbers", async () => {
    const destination = join(workDir, "two-tracks.xml");
    const stereo = { channelCount: 2, sampleRate: 48000, bitDepth: 16, durationFrames: 600 };
    const recording = { ...probed(600), sourceTracks: [stereo, stereo] };

    await saveCutPlan(destination, recording, [{ recordingIn: 0, recordingOut: 60, timelineStart: 0, timelineEnd: 60 }], [1]);

    const xml = new DOMParser().parseFromString(readFileSync(destination, "utf8"), "text/xml");
    const sourceTrackRefs = Array.from(xml.getElementsByTagName("sourcetrack"));
    // One clip per exported TimelineTrack: SourceTrack 2 alone, exploded into its two Channels.
    expect(sourceTrackRefs).toHaveLength(2);
    // SourceTrack 2 owns Channels 3 and 4 of the Recording, whether or not SourceTrack 1 is exported.
    expect(
      sourceTrackRefs.map((reference) => reference.getElementsByTagName("trackindex")[0]?.textContent),
    ).toEqual(["3", "4"]);
  });
});
