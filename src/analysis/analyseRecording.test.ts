import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { analyseRecording } from "./analyseRecording";

// These tests run the real binaries and model in vendor/, which is git-ignored and must be present.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));
const tools = { ffprobe: vendor("ffprobe.exe"), ffmpeg: vendor("ffmpeg.exe"), sileroModel: vendor("silero_vad.onnx") };

// Where the synthesized voice speaks, measured from its own level by bench/make_speech_fixture.ts.
const speechFixture = (name: string) => fileURLToPath(new URL(`../../fixtures/speech/${name}`, import.meta.url));
const voice = (
  JSON.parse(readFileSync(speechFixture("synthetic-speech-16k.json"), "utf8")) as {
    layout: { kind: string; startSeconds: number; endSeconds: number }[];
  }
).layout.filter((piece) => piece.kind === "speech");

const FRAMES_PER_SECOND = 30;

describe("analyseRecording", () => {
  let workDir: string;
  let recordingPath: string;

  // Built like an OBS Recording: 12 s of video at 30 fps, pink noise on SourceTrack 1, and the synthesized voice from
  // fixtures/speech/ on SourceTrack 2, both as AAC. Listening to the wrong SourceTrack finds no speech at all.
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-analysis-"));
    recordingPath = join(workDir, "noise-and-voice.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error"],
      ...["-f", "lavfi", "-i", `testsrc2=size=320x240:rate=${FRAMES_PER_SECOND}`],
      ...["-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.1:seed=7:sample_rate=48000:duration=12.065"],
      ...["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", speechFixture("synthetic-speech-16k.pcm")],
      ...["-filter_complex", "[1:a]aformat=channel_layouts=stereo[noise];[2:a]aresample=48000,aformat=channel_layouts=stereo[voice]"],
      ...["-map", "0:v", "-map", "[noise]", "-map", "[voice]", "-frames:v", "362"],
      ...["-c:v", "mpeg4", "-c:a", "aac", "-b:a", "128k", recordingPath],
    ]);
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // Every kept stretch is a phrase widened by the Margin; the 3.9 s pause between the phrases goes. A MinimumDeadZone
  // of 1.5 s is short enough that the silence before the first phrase and after the last goes too. Silero's edges and
  // the widening to whole frames leave every edge within 0.2 s of the voice's own edge plus or minus the Margin.
  test("listening to the SourceTrack that carries speech keeps each phrase with its Margin and removes the rest", async () => {
    const marginSeconds = 0.3;

    const { cutPlan } = await analyseRecording(
      { recordingPath, voiceSourceTracks: [1], marginSeconds, minimumDeadZoneSeconds: 1.5 },
      tools,
    );

    expect(cutPlan).toHaveLength(voice.length);
    cutPlan.forEach((segment, index) => {
      const phrase = voice[index];
      expect(Math.abs(segment.recordingIn / FRAMES_PER_SECOND - ((phrase?.startSeconds ?? NaN) - marginSeconds))).toBeLessThanOrEqual(0.2);
      expect(Math.abs(segment.recordingOut / FRAMES_PER_SECOND - ((phrase?.endSeconds ?? NaN) + marginSeconds))).toBeLessThanOrEqual(0.2);
    });
  });

  // An empty CutPlan would export as an empty sequence, which looks like a finished edit with nothing in it.
  test("listening only to SourceTracks without speech is refused instead of planning an empty edit", async () => {
    await expect(
      analyseRecording({ recordingPath, voiceSourceTracks: [0], marginSeconds: 0.3, minimumDeadZoneSeconds: 1.5 }, tools),
    ).rejects.toThrow("Nobody speaks on SourceTrack 1, so nothing would be kept. Choose the SourceTracks someone speaks on.");
  });

  // The path does not exist: reading the Recording first would fail with ffprobe's message instead.
  test("choosing no SourceTrack to listen to is refused before the Recording is read", async () => {
    const request = {
      recordingPath: join(workDir, "never-read.mp4"),
      voiceSourceTracks: [],
      marginSeconds: 0.3,
      minimumDeadZoneSeconds: 1.5,
    };

    await expect(analyseRecording(request, tools)).rejects.toThrow("Choose at least one SourceTrack to listen to.");
  });

  // ADR-0004: changing a setting must not mean reading the Recording again, so what it found comes back too.
  test("what it found worth keeping comes back, so cuts can be replanned without reading the Recording again", async () => {
    const { worthKeeping } = await analyseRecording(
      { recordingPath, voiceSourceTracks: [1], marginSeconds: 0.3, minimumDeadZoneSeconds: 1.5 },
      tools,
    );

    expect(worthKeeping).toHaveLength(voice.length);
    worthKeeping.forEach((range, index) => {
      const phrase = voice[index];
      expect(Math.abs(range.startSeconds - (phrase?.startSeconds ?? NaN))).toBeLessThanOrEqual(0.15);
      expect(Math.abs(range.endSeconds - (phrase?.endSeconds ?? NaN))).toBeLessThanOrEqual(0.15);
    });
  });

  // Silero ignores the fixture's pink noise at every setting, so a plan that keeps it can only come from loudness.
  test("deciding by loudness keeps what is above the threshold, noise included, instead of asking Silero", async () => {
    const noise = (
      JSON.parse(readFileSync(speechFixture("synthetic-speech-16k.json"), "utf8")) as {
        layout: { kind: string; startSeconds: number; endSeconds: number }[];
      }
    ).layout.find((piece) => piece.kind === "noise") ?? { startSeconds: NaN, endSeconds: NaN };

    const noiseSecondsKeptAt = async (thresholdDbfs: number) => {
      const { cutPlan } = await analyseRecording(
        {
          recordingPath,
          voiceSourceTracks: [1],
          marginSeconds: 0.3,
          minimumDeadZoneSeconds: 1.5,
          decideBy: { kind: "loudness", thresholdDbfs },
        },
        tools,
      );
      return Math.round(
        cutPlan.reduce(
          (total, segment) =>
            total +
            Math.max(
              0,
              Math.min(segment.recordingOut / FRAMES_PER_SECOND, noise.endSeconds) -
                Math.max(segment.recordingIn / FRAMES_PER_SECOND, noise.startSeconds),
            ),
          0,
        ),
      );
    };

    expect({ at45: await noiseSecondsKeptAt(-45), at30: await noiseSecondsKeptAt(-30) }).toEqual({ at45: 3, at30: 0 });
  });

  // When loudness decided, the message has to name the threshold rather than talk about speech.
  test("a threshold nothing reaches is refused with the threshold in the message", async () => {
    await expect(
      analyseRecording(
        {
          recordingPath,
          voiceSourceTracks: [1],
          marginSeconds: 0.3,
          minimumDeadZoneSeconds: 1.5,
          decideBy: { kind: "loudness", thresholdDbfs: -5 },
        },
        tools,
      ),
    ).rejects.toThrow(
      "Nothing on SourceTrack 2 reaches -5 dBFS, so nothing would be kept. Lower the threshold or choose other SourceTracks.",
    );
  });

  // A ContentEvent is what keeps an explosion in the edit even though nobody says anything while it happens. The
  // Recording built above holds the burst on SourceTrack 1, in the pause between the two phrases.
  describe("a Content SourceTrack", () => {
    let burstRecording: string;

    // SourceTrack 1: quiet pink noise with a 0.4 s tone at 5 s — a bang in an otherwise quiet game.
    // SourceTrack 2: the synthesized voice, whose phrases leave that moment in a pause.
    beforeAll(() => {
      burstRecording = join(workDir, "burst-and-voice.mp4");
      execFileSync(vendor("ffmpeg.exe"), [
        ...["-v", "error"],
        ...["-f", "lavfi", "-i", `testsrc2=size=320x240:rate=${FRAMES_PER_SECOND}`],
        ...["-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.01:seed=11:sample_rate=48000:duration=12.065"],
        ...["-f", "lavfi", "-i", "sine=frequency=200:sample_rate=48000:duration=0.4"],
        ...["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", speechFixture("synthetic-speech-16k.pcm")],
        ...[
          "-filter_complex",
          [
            "[2:a]adelay=5000|5000,apad,atrim=0:12.065[bang]",
            "[1:a][bang]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo[content]",
            "[3:a]aresample=48000,aformat=channel_layouts=stereo[voice]",
          ].join(";"),
        ],
        ...["-map", "0:v", "-map", "[content]", "-map", "[voice]", "-frames:v", "362"],
        ...["-c:v", "mpeg4", "-c:a", "aac", "-b:a", "128k", burstRecording],
      ]);
    });

    /** Whether any KeepSegment covers the moment of the bang. */
    const bangKept = (cutPlan: readonly { recordingIn: number; recordingOut: number }[]) =>
      cutPlan.some(
        (segment) => segment.recordingIn / FRAMES_PER_SECOND <= 5.1 && segment.recordingOut / FRAMES_PER_SECOND >= 5.3,
      );

    test("keeps the moment of a bang that the voice alone would have removed", async () => {
      const listening = {
        recordingPath: burstRecording,
        voiceSourceTracks: [1],
        marginSeconds: 0.3,
        minimumDeadZoneSeconds: 1.5,
      };

      // Nobody speaks during the bang, so listening to the voice alone removes it with the rest of the pause.
      const withoutContent = await analyseRecording(listening, tools);
      expect(bangKept(withoutContent.cutPlan)).toBe(false);

      const withContent = await analyseRecording(
        { ...listening, contentSourceTracks: [0], eventLeadSeconds: 1, eventTailSeconds: 1 },
        tools,
      );

      expect(withContent.contentEvents.length).toBeGreaterThan(0);
      expect(bangKept(withContent.cutPlan)).toBe(true);
      // EventLead and EventTail take the place of the Margin around a ContentEvent (CONTEXT.md), so a second before
      // the bang is kept as well.
      expect(
        withContent.cutPlan.some((segment) => segment.recordingIn / FRAMES_PER_SECOND <= 4.2),
      ).toBe(true);
    }, 120_000);
  });
});
