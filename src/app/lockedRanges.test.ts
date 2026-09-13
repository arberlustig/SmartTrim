import { describe, expect, test } from "vitest";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import type { TrimProject } from "../project/trimProject";
import {
  analysisRequestFrom,
  chooseRecording,
  cutFinished,
  markLockedRangeEnd,
  markLockedRangeStart,
  newCutSession,
  planFinished,
  planSettingsFrom,
  projectOpened,
  redoNeeded,
  removeLockedRange,
  savedChoicesFrom,
  setSourceTrackRole,
} from "./cutSession";

/** A probed ten-minute Recording at 60 fps with two stereo SourceTracks. */
function tenMinutes(path = String.raw`C:\Aufnahmen\long-recording.mp4`): RecordingInfo {
  const durationFrames = 10 * 60 * 60;
  return {
    path,
    frameRate: { numerator: 60, denominator: 1 },
    width: 1920,
    height: 1080,
    durationFrames,
    sourceTracks: Array.from({ length: 2 }, () => ({ channelCount: 2, sampleRate: 48000, bitDepth: 16, durationFrames })),
  };
}

describe("LockedRanges in the session", () => {
  // The owner marks a stretch while listening: "Anfang festhalten" at one moment, "Ende festhalten" at a later one.
  // Until the Ende comes, the Anfang waits on its own and nothing is held yet.
  test("Anfang and Ende festhalten make one LockedRange between the two moments", () => {
    const chosen = chooseRecording(newCutSession(), tenMinutes());

    const started = markLockedRangeStart(chosen, 62.5);
    expect(started.lockedRangeStart).toBe(62.5);
    expect(started.lockedRanges).toEqual([]);

    const held = markLockedRangeEnd(started, 71.25);
    expect(held.lockedRanges).toEqual([{ startSeconds: 62.5, endSeconds: 71.25 }]);
    expect(held.lockedRangeStart).toBe(null);
  });

  // Clicking back in the waveform to find where a moment began is the natural way to mark it, so the Ende often lies
  // before the Anfang. The stretch between the two is what was meant either way.
  test("an Ende marked before its Anfang holds the same stretch", () => {
    const chosen = chooseRecording(newCutSession(), tenMinutes());

    const held = markLockedRangeEnd(markLockedRangeStart(chosen, 71.25), 62.5);

    expect(held.lockedRanges).toEqual([{ startSeconds: 62.5, endSeconds: 71.25 }]);
  });

  // Each of these would hold something nobody meant: a stretch from nowhere, a stretch of no length that keeps not a
  // single frame, or a moment in a Recording that is not there. The window disables the buttons, but the rule stands
  // on its own.
  test("an Ende without its Anfang, a stretch of no length and a mark without a Recording are refused", () => {
    const chosen = chooseRecording(newCutSession(), tenMinutes());

    expect(() => markLockedRangeEnd(chosen, 71.25)).toThrow(/Anfang/);
    expect(() => markLockedRangeEnd(markLockedRangeStart(chosen, 62.5), 62.5)).toThrow(/no length/);
    expect(() => markLockedRangeStart(newCutSession(), 62.5)).toThrow(/Recording/);
  });

  // The list under the waveforms shows each held stretch once, in the order of the Recording. Two held stretches
  // that overlap or touch hold one stretch, and listing them twice would make removing one of them keep the other.
  test("held stretches that overlap or touch become one, and the list stays in the order of the Recording", () => {
    const hold = (session: ReturnType<typeof newCutSession>, from: number, to: number) =>
      markLockedRangeEnd(markLockedRangeStart(session, from), to);
    const chosen = chooseRecording(newCutSession(), tenMinutes());

    const apart = hold(hold(chosen, 70, 80), 30, 40);
    expect(apart.lockedRanges).toEqual([
      { startSeconds: 30, endSeconds: 40 },
      { startSeconds: 70, endSeconds: 80 },
    ]);

    // 35..75 overlaps both, so all three are one stretch from 30 to 80.
    expect(hold(apart, 35, 75).lockedRanges).toEqual([{ startSeconds: 30, endSeconds: 80 }]);
    // 40..50 only touches 30..40: still one stretch, no Join between them.
    expect(hold(apart, 40, 50).lockedRanges).toEqual([
      { startSeconds: 30, endSeconds: 50 },
      { startSeconds: 70, endSeconds: 80 },
    ]);
  });

  // A held stretch is a moment in one Recording. Carried over, it would hold whatever happens at that moment of the
  // next Recording — and a waiting Anfang would join up with an Ende pressed somewhere else entirely.
  test("choosing another Recording lets go of every held stretch and of a waiting Anfang", () => {
    const held = markLockedRangeEnd(markLockedRangeStart(chooseRecording(newCutSession(), tenMinutes()), 30), 40);
    const waiting = markLockedRangeStart(held, 100);

    const switched = chooseRecording(waiting, tenMinutes(String.raw`C:\Aufnahmen\part3.mp4`));

    expect(switched.lockedRanges).toEqual([]);
    expect(switched.lockedRangeStart).toBe(null);
  });

  // "entfernen" beside one entry of the list lets go of that stretch and of nothing else.
  test("removing a held stretch from the list leaves the others held", () => {
    const hold = (session: ReturnType<typeof newCutSession>, from: number, to: number) =>
      markLockedRangeEnd(markLockedRangeStart(session, from), to);
    const three = hold(hold(hold(chooseRecording(newCutSession(), tenMinutes()), 10, 20), 30, 40), 50, 60);

    expect(removeLockedRange(three, 1).lockedRanges).toEqual([
      { startSeconds: 10, endSeconds: 20 },
      { startSeconds: 50, endSeconds: 60 },
    ]);
    // A stale button from before a redraw must not remove a stretch that happens to sit at that place now.
    expect(() => removeLockedRange(three, 3)).toThrow(/no held stretch/);
  });

  // Holding a stretch or letting it go changes only how the cuts are planned around what was already found, so it
  // must cost a replan of milliseconds and never a new read of the Recording (ADR-0004).
  test("holding or letting go of a stretch after a cut only asks for a replan, which carries the held stretches", () => {
    const cut = cutFinished(setSourceTrackRole(chooseRecording(newCutSession(), tenMinutes()), 0, "voice"));
    expect(redoNeeded(cut)).toBe("nothing");

    const held = markLockedRangeEnd(markLockedRangeStart(cut, 30), 40);
    expect(redoNeeded(held)).toBe("replan");
    expect(planSettingsFrom(held).lockedRanges).toEqual([{ startSeconds: 30, endSeconds: 40 }]);
    // Pressing Schneiden now plans with them as well.
    expect(analysisRequestFrom(held).lockedRanges).toEqual([{ startSeconds: 30, endSeconds: 40 }]);

    // Once the plan has caught up nothing is owed, and letting the stretch go again is another replan.
    const planned = planFinished(held);
    expect(redoNeeded(planned)).toBe("nothing");
    expect(redoNeeded(removeLockedRange(planned, 0))).toBe("replan");
    // A waiting Anfang holds nothing yet, so it owes nothing either.
    expect(redoNeeded(markLockedRangeStart(planned, 100))).toBe("nothing");
  });

  // Saving hands the held stretches on, and a reopened project puts them back. A project from before held stretches
  // opens with none — not with whatever the session open before it held (ADR-0016, ADR-0023).
  test("saving hands the held stretches on, and a reopened project puts back exactly its own", () => {
    const held = markLockedRangeEnd(markLockedRangeStart(chooseRecording(newCutSession(), tenMinutes()), 30), 40);
    expect(savedChoicesFrom(held).lockedRanges).toEqual([{ startSeconds: 30, endSeconds: 40 }]);

    const project: TrimProject = {
      recording: tenMinutes(),
      listenTo: [0],
      exportSourceTracks: [0, 1],
      decideBy: { kind: "loudness", thresholdDbfs: -40 },
      marginSeconds: 0.05,
      minimumDeadZoneSeconds: 0.25,
      worthKeeping: [],
    };
    const reopened = projectOpened(newCutSession(), {
      ...project,
      lockedRanges: [{ startSeconds: 62.5, endSeconds: 71.25 }],
    });
    expect(reopened.lockedRanges).toEqual([{ startSeconds: 62.5, endSeconds: 71.25 }]);
    // The plan was recomputed on opening with them already, so nothing is owed.
    expect(redoNeeded(reopened)).toBe("nothing");

    const older = projectOpened(markLockedRangeStart(held, 100), project);
    expect(older.lockedRanges).toEqual([]);
    expect(older.lockedRangeStart).toBe(null);
  });
});
