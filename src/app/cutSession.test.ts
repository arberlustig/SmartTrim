import { describe, expect, test } from "vitest";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import type { SourceTrackScan } from "../scan/scanSourceTracks";
import {
  analysisRequestFrom,
  canCut,
  chooseRecording,
  newCutSession,
  canExport,
  revealEmptySourceTracks,
  setMarginSeconds,
  setMinimumDeadZoneSeconds,
  setThresholdDbfs,
  toggleExportSourceTrack,
  toggleSourceTrack,
  visibleSourceTracks,
} from "./cutSession";

/** A probed Recording with `sourceTracks` stereo SourceTracks, like the OBS captures the owner feeds SmartTrim. */
function probed(path: string, sourceTracks: number): RecordingInfo {
  return {
    path,
    frameRate: { numerator: 60, denominator: 1 },
    width: 1920,
    height: 1080,
    durationFrames: 600,
    sourceTracks: Array.from({ length: sourceTracks }, () => ({
      channelCount: 2,
      sampleRate: 48000,
      bitDepth: 16,
      durationFrames: 600,
    })),
  };
}

/** A scan saying which SourceTracks carried sound, the way `scanSourceTracks` reports it. */
function scanned(carriesSound: readonly boolean[]): SourceTrackScan[] {
  return carriesSound.map((sound) => ({
    carriesSound: sound,
    peakDbfs: sound ? -12 : -Infinity,
    slicesWithSound: sound ? 5 : 0,
    sliceCount: 5,
  }));
}

describe("cutSession", () => {
  // The owner's settings, measured against the alternatives in ADR-0003: loudness at -40 dBFS, 0.05 s Margin,
  // 0.25 s MinimumDeadZone. Whoever opens the window should be able to press Schneiden without touching a slider.
  test("a fresh session starts on the owner's settings and cannot cut yet", () => {
    const session = newCutSession();

    expect(session.thresholdDbfs).toBe(-40);
    expect(session.marginSeconds).toBe(0.05);
    expect(session.minimumDeadZoneSeconds).toBe(0.25);
    // Nothing to cut and nothing to listen to before the user has chosen a Recording.
    expect(session.recording).toBe(null);
    expect(session.listenTo).toEqual([]);
    expect(canCut(session)).toBe(false);
  });

  test("a Recording with one SourceTrack ticked can be cut, and unticking it takes that back", () => {
    const chosen = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\long-recording.mp4`, 6));
    expect(chosen.recording?.path).toBe(String.raw`C:\Aufnahmen\long-recording.mp4`);
    // Choosing a Recording alone decides nothing: which SourceTrack carries the voice is the user's call.
    expect(canCut(chosen)).toBe(false);

    // SourceTrack 5 of the long Recording is the one the owner speaks on, so position 4.
    const listening = toggleSourceTrack(chosen, 4);
    expect(listening.listenTo).toEqual([4]);
    expect(canCut(listening)).toBe(true);

    const unticked = toggleSourceTrack(listening, 4);
    expect(unticked.listenTo).toEqual([]);
    expect(canCut(unticked)).toBe(false);
  });

  // A tick is a position in one Recording. Carrying it over would listen to whatever sits at that position in the
  // next Recording, or to a SourceTrack that is not there at all.
  test("choosing another Recording forgets the ticks that pointed into the old one", () => {
    const listening = toggleSourceTrack(chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\long-recording.mp4`, 6)), 4);

    const switched = chooseRecording(listening, probed(String.raw`C:\Aufnahmen\part3.mp4`, 2));

    expect(switched.recording?.sourceTracks).toHaveLength(2);
    expect(switched.listenTo).toEqual([]);
    expect(canCut(switched)).toBe(false);
  });

  test("ticking a SourceTrack the Recording does not have is refused", () => {
    const session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\part3.mp4`, 2));

    expect(() => toggleSourceTrack(session, 4)).toThrow("SourceTrack 5");
    expect(() => toggleSourceTrack(newCutSession(), 0)).toThrow(/Recording/);
  });

  // The sliders are the only way these reach the analysis, and each end of each slider is a value the owner could
  // plausibly want: quieter than -60 dBFS is the noise floor, and a MinimumDeadZone under 0.1 s cuts on breaths.
  test("the sliders stay inside their ranges", () => {
    const session = newCutSession();

    expect(setThresholdDbfs(session, -35).thresholdDbfs).toBe(-35);
    expect(setThresholdDbfs(session, -99).thresholdDbfs).toBe(-60);
    expect(setThresholdDbfs(session, 0).thresholdDbfs).toBe(-20);

    expect(setMarginSeconds(session, 0.3).marginSeconds).toBe(0.3);
    expect(setMarginSeconds(session, -1).marginSeconds).toBe(0);
    expect(setMarginSeconds(session, 9).marginSeconds).toBe(1);

    expect(setMinimumDeadZoneSeconds(session, 2).minimumDeadZoneSeconds).toBe(2);
    expect(setMinimumDeadZoneSeconds(session, 0).minimumDeadZoneSeconds).toBe(0.1);
    expect(setMinimumDeadZoneSeconds(session, 99).minimumDeadZoneSeconds).toBe(5);
  });

  test("the session hands the analysis exactly what the user set", () => {
    let session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\long-recording.mp4`, 6));
    session = toggleSourceTrack(toggleSourceTrack(session, 4), 0);
    session = setThresholdDbfs(setMinimumDeadZoneSeconds(session, 0.8), -45);

    expect(analysisRequestFrom(session)).toEqual({
      recordingPath: String.raw`C:\Aufnahmen\long-recording.mp4`,
      voiceSourceTracks: [0, 4],
      decideBy: { kind: "loudness", thresholdDbfs: -45 },
      marginSeconds: 0.05,
      minimumDeadZoneSeconds: 0.8,
    });
  });

  test("nothing can be asked of the analysis before a Recording and a SourceTrack are chosen", () => {
    expect(() => analysisRequestFrom(newCutSession())).toThrow(/Recording/);
    const chosen = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\long-recording.mp4`, 6));
    expect(() => analysisRequestFrom(chosen)).toThrow(/SourceTrack/);
  });

  // A real OBS Recording had two SourceTracks nobody was ever routed to. Offering them means the user has to work
  // out which of six tracks are real; CONTEXT.md says SmartTrim hides them rather than asking.
  test("SourceTracks that carry no sound are left out of the list", () => {
    const recording = probed(String.raw`C:\Aufnahmen\obs.mp4`, 6);

    const withScan = chooseRecording(newCutSession(), recording, scanned([true, false, true, false, true, true]));
    expect(visibleSourceTracks(withScan)).toEqual([0, 2, 4, 5]);

    // Without a scan nothing is known about the SourceTracks, so nothing may be hidden.
    expect(visibleSourceTracks(chooseRecording(newCutSession(), recording))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  // A slice is a sample: a SourceTrack that only makes a sound between the slices looks empty. The user has to be
  // able to reach it, and a tick must still mean the SourceTrack it was drawn next to.
  test("the hidden SourceTracks can be shown again, and ticking one still points at that SourceTrack", () => {
    const session = chooseRecording(
      newCutSession(),
      probed(String.raw`C:\Aufnahmen\obs.mp4`, 6),
      scanned([true, false, true, false, true, true]),
    );

    const revealed = revealEmptySourceTracks(session, true);
    expect(visibleSourceTracks(revealed)).toEqual([0, 1, 2, 3, 4, 5]);

    const listening = toggleSourceTrack(revealed, 1);
    expect(listening.listenTo).toEqual([1]);
    expect(analysisRequestFrom(listening).voiceSourceTracks).toEqual([1]);
    // Hiding them again leaves the tick alone: it is the user's choice, not the scan's.
    expect(revealEmptySourceTracks(listening, false).listenTo).toEqual([1]);
  });

  // Which SourceTracks are cut by and which end up in Premiere are two different questions. Everything is exported
  // until the user says otherwise, so nobody loses the game audio by ticking only the microphone (ADR-0014).
  test("every SourceTrack is exported to begin with, and unticking them one by one is allowed until none is left", () => {
    const session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));
    expect(session.exportSourceTracks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(canExport(session)).toBe(true);

    // The owner's Recordings hold the same mixdown three times; dropping two of them is the point of this.
    const fewer = toggleExportSourceTrack(toggleExportSourceTrack(session, 0), 5);
    expect(fewer.exportSourceTracks).toEqual([1, 2, 3, 4]);
    expect(toggleExportSourceTrack(fewer, 0).exportSourceTracks).toEqual([0, 1, 2, 3, 4]);

    const none = [1, 2, 3, 4].reduce(toggleExportSourceTrack, fewer);
    expect(none.exportSourceTracks).toEqual([]);
    // A Premiere sequence without any audio looks like an edit whose sound was lost.
    expect(canExport(none)).toBe(false);
  });

  // The export choice changes the file, never the cut, so a finished cut stays valid while it is changed.
  test("what is exported has no say in what is cut", () => {
    let session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));
    session = toggleSourceTrack(session, 4);

    const request = analysisRequestFrom(toggleExportSourceTrack(session, 4));

    expect(request.voiceSourceTracks).toEqual([4]);
  });
});
