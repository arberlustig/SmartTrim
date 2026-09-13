import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { TimeRange } from "../cutting/planCuts";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import { readTrimProject, trimProjectText, type TrimProject } from "./trimProject";

const recording: RecordingInfo = {
  path: String.raw`C:\Aufnahmen\obs.mp4`,
  frameRate: { numerator: 60, denominator: 1 },
  width: 1920,
  height: 1080,
  durationFrames: 90838,
  sourceTracks: [
    { channelCount: 2, sampleRate: 48000, bitDepth: 16, durationFrames: 90838 },
    { channelCount: 2, sampleRate: 48000, bitDepth: 16, durationFrames: 90836 },
  ],
};

const project: TrimProject = {
  recording,
  listenTo: [1],
  exportSourceTracks: [0, 1],
  // A SourceTrack that carries nothing has no peak at all; JSON cannot spell -Infinity, so the round trip has to.
  scan: [
    { carriesSound: true, peakDbfs: -1.2, slicesWithSound: 5, sliceCount: 5 },
    { carriesSound: false, peakDbfs: -Infinity, slicesWithSound: 0, sliceCount: 5 },
  ],
  decideBy: { kind: "loudness", thresholdDbfs: -40 },
  marginSeconds: 0.05,
  minimumDeadZoneSeconds: 0.25,
  contentSourceTracks: [0],
  eventLeadSeconds: 1.5,
  eventTailSeconds: 2,
  contentEvents: [{ startSeconds: 5, endSeconds: 5.4 }],
  worthKeeping: [
    { startSeconds: 2.112, endSeconds: 3.802 },
    { startSeconds: 7.713, endSeconds: 9.239 },
  ],
};

describe("the TrimProject file", () => {
  // What a session is worth reopening for: the stretches the analysis found, so the Recording is not read again.
  test("everything a session needs comes back out of the file it was written to", () => {
    const reopened = readTrimProject(trimProjectText(project));

    expect(reopened).toEqual(project);
  });

  // Held stretches are the user's own work on this Recording (ADR-0023). A reopened project that forgot them would
  // quietly cut away what the user had marked to keep.
  test("held stretches come back out of the file they were written to", () => {
    const withHeld: TrimProject = {
      ...project,
      lockedRanges: [
        { startSeconds: 62.5, endSeconds: 71.25 },
        { startSeconds: 1200, endSeconds: 1234.5 },
      ],
    };

    expect(readTrimProject(trimProjectText(withHeld))).toEqual(withHeld);
  });

  // Held stretches pass through one rule wherever they come from (ADR-0023). A file written by hand or by another
  // version can hold them out of order, overlapping, or with their edges swapped; planned as they stand, a swapped
  // pair would give a KeepSegment that runs backwards in the Premiere sequence.
  test("held stretches read from a file come back in order, joined, and with their edges the right way round", () => {
    const untidy: TimeRange[] = [
      { startSeconds: 80, endSeconds: 70 },
      { startSeconds: 10, endSeconds: 20 },
      { startSeconds: 15, endSeconds: 30 },
    ];

    const reopened = readTrimProject(trimProjectText({ ...project, lockedRanges: untidy }));

    expect(reopened.lockedRanges).toEqual([
      { startSeconds: 10, endSeconds: 30 },
      { startSeconds: 70, endSeconds: 80 },
    ]);
  });

  // A list of held stretches that is there but broken is refused like any other broken field. Opening the project
  // without it would silently cut away everything the user had held.
  test("a file whose held stretches are damaged is refused rather than opened without them", () => {
    const damaged = JSON.parse(
      trimProjectText({ ...project, lockedRanges: [{ startSeconds: 62.5, endSeconds: 71.25 }] }),
    ) as Record<string, unknown>;
    damaged["lockedRanges"] = [{ startSeconds: 62.5 }];

    expect(() => readTrimProject(JSON.stringify(damaged))).toThrow("lockedRanges");
  });

  test("a file that is not a TrimProject, or from a newer SmartTrim, is refused rather than half read", () => {
    expect(() => readTrimProject("{}")).toThrow("not a SmartTrim project");
    expect(() => readTrimProject("this is not JSON at all")).toThrow("not a SmartTrim project");
    // A later version may hold things this one would silently drop on the next save.
    // Written by a SmartTrim that knows a format this one does not.
    expect(() => readTrimProject(trimProjectText(project).replace(/"smarttrim": \d+/, '"smarttrim": 99'))).toThrow(
      "was saved by a newer version of SmartTrim",
    );
    // Half a project is not a project: a file without the analysis could not be replanned.
    const withoutRanges = JSON.parse(trimProjectText(project)) as Record<string, unknown>;
    delete withoutRanges["worthKeeping"];
    expect(() => readTrimProject(JSON.stringify(withoutRanges))).toThrow("worthKeeping");
  });

  // The point of a format number is that a file written by an earlier SmartTrim still opens. This one is checked in
  // and must keep opening for as long as format 1 is readable — whatever the code around it turns into.
  test("a project file written in format 1 still opens", () => {
    const text = readFileSync(
      fileURLToPath(new URL("../../fixtures/trimproject/version-1.smarttrim", import.meta.url)),
      "utf8",
    );

    const reopened = readTrimProject(text);

    expect(reopened.recording.path).toBe("C:/Aufnahmen/obs.mp4");
    expect(reopened.recording.durationFrames).toBe(90838);
    expect(reopened.recording.sourceTracks).toHaveLength(2);
    expect(reopened.listenTo).toEqual([1]);
    expect(reopened.exportSourceTracks).toEqual([0, 1]);
    expect(reopened.decideBy).toEqual({ kind: "loudness", thresholdDbfs: -40 });
    expect(reopened.marginSeconds).toBe(0.05);
    expect(reopened.minimumDeadZoneSeconds).toBe(0.25);
    expect(reopened.worthKeeping).toEqual([
      { startSeconds: 12.5, endSeconds: 48.25 },
      { startSeconds: 51, endSeconds: 300.125 },
      { startSeconds: 1400, endSeconds: 1509.5 },
    ]);
    // JSON has no -Infinity, so a silent SourceTrack's peak is written as null and read back as silence.
    expect(reopened.scan?.[1]).toEqual({ carriesSound: false, peakDbfs: -Infinity, slicesWithSound: 0, sliceCount: 5 });
  });

  // Format 1 knew nothing about Content SourceTracks. Its files must still open, with no moments and no EventLead.
  test("a format 1 file opens as a session without Content SourceTracks", () => {
    const text = readFileSync(
      fileURLToPath(new URL("../../fixtures/trimproject/version-1.smarttrim", import.meta.url)),
      "utf8",
    );

    const reopened = readTrimProject(text);

    expect(reopened.contentSourceTracks ?? []).toEqual([]);
    expect(reopened.contentEvents ?? []).toEqual([]);
    expect(reopened.eventLeadSeconds ?? 0).toBe(0);
    expect(reopened.eventTailSeconds ?? 0).toBe(0);
  });
});
