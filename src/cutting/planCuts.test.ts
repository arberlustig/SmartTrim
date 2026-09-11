import { describe, expect, test } from "vitest";
import { planCuts } from "./planCuts";

const fps30 = { numerator: 30, denominator: 1 };
const noContentEvents = { contentEvents: [], eventLeadSeconds: 0, eventTailSeconds: 0 } as const;
const noLockedRanges = { lockedRanges: [] } as const;

describe("planCuts", () => {
  test("speech throughout the Recording keeps all of it as one KeepSegment", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [{ startSeconds: 0, endSeconds: 60 }],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.3,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 0, recordingOut: 1800, timelineStart: 0, timelineEnd: 1800 },
    ]);
  });

  test("one stretch of speech keeps just that stretch with Margin on both sides", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [{ startSeconds: 10, endSeconds: 12 }],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 285, recordingOut: 375, timelineStart: 0, timelineEnd: 90 },
    ]);
  });

  test("a DeadZone between two stretches of speech is removed and the timeline closes the gap", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [
        { startSeconds: 10, endSeconds: 12 },
        { startSeconds: 20, endSeconds: 22 },
      ],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 285, recordingOut: 375, timelineStart: 0, timelineEnd: 90 },
      { recordingIn: 585, recordingOut: 675, timelineStart: 90, timelineEnd: 180 },
    ]);
  });

  // ADR-0007: the 2.5 s pause would qualify on its own, but only 1.5 s remain once Margin is kept.
  test("a pause shorter than the MinimumDeadZone after Margin is kept stays in the edit", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [
        { startSeconds: 10, endSeconds: 12 },
        { startSeconds: 14.5, endSeconds: 16.5 },
      ],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 285, recordingOut: 510, timelineStart: 0, timelineEnd: 225 },
    ]);
  });

  test("a pause at the start of the Recording shorter than the MinimumDeadZone stays in the edit", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [{ startSeconds: 1.5, endSeconds: 5 }],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 0, recordingOut: 165, timelineStart: 0, timelineEnd: 165 },
    ]);
  });

  test("a pause at the end of the Recording shorter than the MinimumDeadZone stays in the edit", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [{ startSeconds: 50, endSeconds: 58.5 }],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 1485, recordingOut: 1800, timelineStart: 0, timelineEnd: 315 },
    ]);
  });

  test("KeepSegment boundaries between frames are widened to whole frames, never narrowed", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [{ startSeconds: 10.01, endSeconds: 12.01 }],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 285, recordingOut: 376, timelineStart: 0, timelineEnd: 91 },
    ]);
  });

  // In floating point, 16.1 s × 30 is 482.99999999999994 and 16.6 s × 30 is 498.00000000000006.
  test("boundaries that fall exactly on a frame are not widened by floating-point noise", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [{ startSeconds: 16.2, endSeconds: 16.5 }],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.1,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 483, recordingOut: 498, timelineStart: 0, timelineEnd: 15 },
    ]);
  });

  // Regression guard: the predecessor assumed a frame rate. Green from the start, because the
  // exact ratio has been used since the first slice. At a flat 30 fps this would be 285–375.
  test("frame positions follow the probed frame rate, including NTSC 29.97", () => {
    const plan = planCuts({
      recording: { durationFrames: 1798, frameRate: { numerator: 30000, denominator: 1001 } },
      speech: [{ startSeconds: 10, endSeconds: 12 }],
      ...noContentEvents,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    // 9.5 s × 30000/1001 = 284.72 → 284; 12.5 s × 30000/1001 = 374.63 → 375
    expect(plan).toEqual([
      { recordingIn: 284, recordingOut: 375, timelineStart: 0, timelineEnd: 91 },
    ]);
  });

  test("a ContentEvent without speech keeps EventLead before it and EventTail after it", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [],
      contentEvents: [{ startSeconds: 30, endSeconds: 31 }],
      eventLeadSeconds: 3,
      eventTailSeconds: 2,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 810, recordingOut: 990, timelineStart: 0, timelineEnd: 180 },
    ]);
  });

  test("a ContentEvent between two stretches of speech takes its place in Recording order", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [
        { startSeconds: 10, endSeconds: 12 },
        { startSeconds: 40, endSeconds: 42 },
      ],
      contentEvents: [{ startSeconds: 25, endSeconds: 26 }],
      eventLeadSeconds: 3,
      eventTailSeconds: 2,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 285, recordingOut: 375, timelineStart: 0, timelineEnd: 90 },
      { recordingIn: 660, recordingOut: 840, timelineStart: 90, timelineEnd: 270 },
      { recordingIn: 1185, recordingOut: 1275, timelineStart: 270, timelineEnd: 360 },
    ]);
  });

  test("a ContentEvent inside a stretch of speech never shortens its KeepSegment", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [{ startSeconds: 10, endSeconds: 20 }],
      contentEvents: [{ startSeconds: 12, endSeconds: 13 }],
      eventLeadSeconds: 1,
      eventTailSeconds: 1,
      ...noLockedRanges,
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    expect(plan).toEqual([
      { recordingIn: 285, recordingOut: 615, timelineStart: 0, timelineEnd: 330 },
    ]);
  });

  test("a LockedRange is kept exactly as marked, without Margin", () => {
    const plan = planCuts({
      recording: { durationFrames: 1800, frameRate: fps30 },
      speech: [],
      ...noContentEvents,
      lockedRanges: [{ startSeconds: 30, endSeconds: 40 }],
      marginSeconds: 0.5,
      minimumDeadZoneSeconds: 2,
    });

    // With Margin added it would be 885–1215.
    expect(plan).toEqual([
      { recordingIn: 900, recordingOut: 1200, timelineStart: 0, timelineEnd: 300 },
    ]);
  });
});
