import { describe, expect, test } from "vitest";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import type { TrimProject } from "../project/trimProject";
import type { SourceTrackScan } from "../scan/scanSourceTracks";
import {
  analysisRequestFrom,
  canCut,
  chooseRecording,
  newCutSession,
  canExport,
  cutFinished,
  planFinished,
  projectOpened,
  savedChoicesFrom,
  planSettingsFrom,
  redoNeeded,
  revealEmptySourceTracks,
  setMarginSeconds,
  setMinimumDeadZoneSeconds,
  setThresholdDbfs,
  toggleExportSourceTrack,
  PRESETS,
  applyPreset,
  presetChoice,
  sourceTracksToRead,
  type Preset,
  roleOf,
  setEventLeadSeconds,
  setEventTailSeconds,
  setSourceTrackRole,
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
    const listening = setSourceTrackRole(chosen, 4, "voice");
    expect(listening.listenTo).toEqual([4]);
    expect(canCut(listening)).toBe(true);

    const unticked = setSourceTrackRole(listening, 4, "ignored");
    expect(unticked.listenTo).toEqual([]);
    expect(canCut(unticked)).toBe(false);
  });

  // A tick is a position in one Recording. Carrying it over would listen to whatever sits at that position in the
  // next Recording, or to a SourceTrack that is not there at all.
  test("choosing another Recording forgets the ticks that pointed into the old one", () => {
    const listening = setSourceTrackRole(chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\long-recording.mp4`, 6)), 4, "voice");

    const switched = chooseRecording(listening, probed(String.raw`C:\Aufnahmen\part3.mp4`, 2));

    expect(switched.recording?.sourceTracks).toHaveLength(2);
    expect(switched.listenTo).toEqual([]);
    expect(canCut(switched)).toBe(false);
  });

  test("ticking a SourceTrack the Recording does not have is refused", () => {
    const session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\part3.mp4`, 2));

    expect(() => setSourceTrackRole(session, 4, "voice")).toThrow("SourceTrack 5");
    expect(() => setSourceTrackRole(newCutSession(), 0, "voice")).toThrow(/Recording/);
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
    session = setSourceTrackRole(setSourceTrackRole(session, 4, "voice"), 0, "voice");
    session = setThresholdDbfs(setMinimumDeadZoneSeconds(session, 0.8), -45);

    expect(analysisRequestFrom(session)).toEqual({
      recordingPath: String.raw`C:\Aufnahmen\long-recording.mp4`,
      voiceSourceTracks: [0, 4],
      contentSourceTracks: [],
      decideBy: { kind: "loudness", thresholdDbfs: -45 },
      marginSeconds: 0.05,
      eventLeadSeconds: 1.5,
      eventTailSeconds: 2,
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

    const listening = setSourceTrackRole(revealed, 1, "voice");
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
    session = setSourceTrackRole(session, 4, "voice");

    const request = analysisRequestFrom(toggleExportSourceTrack(session, 4));

    expect(request.voiceSourceTracks).toEqual([4]);
  });

  // The owner asked for this on 2026-09-12: a SourceTrack the window hides must not arrive in Premiere anyway, or
  // the only way to drop it is to show the hidden SourceTracks again and untick them one by one (ADR-0014).
  test("SourceTracks the scan found nothing on start out unexported, like they start out hidden", () => {
    const recording = probed(String.raw`C:\Aufnahmen\obs.mp4`, 6);

    const session = chooseRecording(newCutSession(), recording, scanned([true, false, true, false, true, true]));

    expect(session.exportSourceTracks).toEqual([0, 2, 4, 5]);
    expect(canExport(session)).toBe(true);
    // Showing them does not export them: that stays the user's tick.
    expect(revealEmptySourceTracks(session, true).exportSourceTracks).toEqual([0, 2, 4, 5]);
    expect(toggleExportSourceTrack(session, 1).exportSourceTracks).toEqual([0, 1, 2, 4, 5]);
  });

  // Without a scan nothing is known, so nothing may be dropped — the same rule that keeps them all visible.
  test("with no scan every SourceTrack is exported", () => {
    const session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));

    expect(session.exportSourceTracks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  // ADR-0004: the Recording is read once. Luft and Pause only decide how the cuts are planned around what was
  // found, so moving them may not cost a second read; the threshold and the SourceTracks decide what is found at all.
  test("Luft and Pause only need replanning, the threshold decides again, another SourceTrack needs a new read", () => {
    let session = setSourceTrackRole(chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6)), 4, "voice");
    expect(redoNeeded(session)).toBe("analyse");

    session = cutFinished(session);
    expect(redoNeeded(session)).toBe("nothing");

    expect(redoNeeded(setMarginSeconds(session, 0.3))).toBe("replan");
    expect(redoNeeded(setMinimumDeadZoneSeconds(session, 2))).toBe("replan");
    expect(planSettingsFrom(setMarginSeconds(session, 0.3))).toEqual({
      marginSeconds: 0.3,
      eventLeadSeconds: 1.5,
      eventTailSeconds: 2,
      minimumDeadZoneSeconds: 0.25,
    });

    // The decoded audio is still in memory, so another threshold is decided from it rather than read again (ADR-0004).
    expect(redoNeeded(setThresholdDbfs(session, -45))).toBe("redecide");
    // Another SourceTrack is audio nobody has decoded yet.
    expect(redoNeeded(setSourceTrackRole(session, 0, "voice"))).toBe("analyse");
    // A threshold and a Margin at once is still one job, and it is the one that decides again.
    expect(redoNeeded(setMarginSeconds(setThresholdDbfs(session, -45), 0.3))).toBe("redecide");
    // What is exported has no say in the plan at all (ADR-0014).
    expect(redoNeeded(toggleExportSourceTrack(session, 0))).toBe("nothing");
  });

  test("choosing another Recording forgets that a plan was ever made", () => {
    const planned = cutFinished(
      setSourceTrackRole(chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6)), 4, "voice"),
    );

    const switched = setSourceTrackRole(chooseRecording(planned, probed(String.raw`C:\Aufnahmen\other.mp4`, 2)), 0, "voice");

    expect(redoNeeded(switched)).toBe("analyse");
  });

  // A saved project holds what the analysis found, not the audio it found it in (ADR-0004). So Luft and Pause still
  // cost nothing after reopening, while another threshold has to read the Recording again.
  test("a reopened project replans for free, but a new threshold needs the Recording read again", () => {
    const recording = probed(String.raw`C:\Aufnahmen\obs.mp4`, 6);
    const saved: TrimProject = {
      recording,
      listenTo: [4],
      exportSourceTracks: [0, 4],
      scan: scanned([true, false, true, false, true, true]),
      decideBy: { kind: "loudness", thresholdDbfs: -45 },
      marginSeconds: 0.2,
      minimumDeadZoneSeconds: 1.2,
      worthKeeping: [{ startSeconds: 1, endSeconds: 2 }],
    };

    const session = projectOpened(newCutSession(), saved);

    // Everything the user had chosen is back on screen.
    expect(session.recording?.path).toBe(recording.path);
    expect(session.listenTo).toEqual([4]);
    expect(session.exportSourceTracks).toEqual([0, 4]);
    expect(session.thresholdDbfs).toBe(-45);
    expect(session.marginSeconds).toBe(0.2);
    expect(session.minimumDeadZoneSeconds).toBe(1.2);
    expect(visibleSourceTracks(session)).toEqual([0, 2, 4, 5]);
    expect(redoNeeded(session)).toBe("nothing");

    expect(redoNeeded(setMarginSeconds(session, 0.05))).toBe("replan");
    // Nothing was decoded, so this one cannot be decided from memory.
    expect(redoNeeded(setThresholdDbfs(session, -40))).toBe("analyse");
  });

  // Replanning and deciding again catch the plan up with the settings; neither of them decodes anything, so
  // whether the audio is in memory is left exactly as it was.
  test("a replan after reopening does not pretend the audio is back", () => {
    const cut = cutFinished(setSourceTrackRole(chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6)), 4, "voice"));
    expect(redoNeeded(setThresholdDbfs(cut, -45))).toBe("redecide");

    const replanned = planFinished(setMarginSeconds(cut, 0.3));
    expect(redoNeeded(replanned)).toBe("nothing");
    expect(redoNeeded(setThresholdDbfs(replanned, -45))).toBe("redecide");
  });

  // Saving has to describe the cut that is on screen: the SourceTracks it listened to and the settings it was made
  // with, plus the export ticks, which the file remembers even though they had no say in the plan (ADR-0014).
  test("what gets saved is what the cut on screen was made of", () => {
    let session = chooseRecording(
      newCutSession(),
      probed(String.raw`C:\Aufnahmen\obs.mp4`, 6),
      scanned([true, false, true, false, true, true]),
    );
    session = cutFinished(setThresholdDbfs(setSourceTrackRole(session, 4, "voice"), -45));
    session = toggleExportSourceTrack(session, 0);

    expect(savedChoicesFrom(session)).toEqual({
      voiceSourceTracks: [4],
      contentSourceTracks: [],
      exportSourceTracks: [2, 4, 5],
      decideBy: { kind: "loudness", thresholdDbfs: -45 },
      marginSeconds: 0.05,
      eventLeadSeconds: 1.5,
      eventTailSeconds: 2,
      minimumDeadZoneSeconds: 0.25,
      scan: scanned([true, false, true, false, true, true]),
    });
  });

  // CONTEXT.md: a SourceTrack has exactly one TrackRole. The game track drives no cuts of its own, it only keeps
  // its moments alive, and the two lists must never hold the same SourceTrack.
  test("a SourceTrack has exactly one role at a time", () => {
    let session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));
    expect(roleOf(session, 2)).toBe("ignored");

    session = setSourceTrackRole(session, 2, "voice");
    expect(roleOf(session, 2)).toBe("voice");
    expect(session.listenTo).toEqual([2]);

    session = setSourceTrackRole(session, 2, "content");
    expect(roleOf(session, 2)).toBe("content");
    expect(session.listenTo).toEqual([]);
    expect(session.contentSourceTracks).toEqual([2]);

    session = setSourceTrackRole(session, 2, "ignored");
    expect(roleOf(session, 2)).toBe("ignored");
    expect(session.contentSourceTracks).toEqual([]);
  });

  test("the Content SourceTracks and what is kept around their moments reach the analysis", () => {
    let session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));
    session = setSourceTrackRole(setSourceTrackRole(session, 4, "voice"), 2, "content");
    session = setEventTailSeconds(setEventLeadSeconds(session, 1.5), 2.5);

    expect(analysisRequestFrom(session)).toEqual({
      recordingPath: String.raw`C:\Aufnahmen\obs.mp4`,
      voiceSourceTracks: [4],
      contentSourceTracks: [2],
      decideBy: { kind: "loudness", thresholdDbfs: -40 },
      marginSeconds: 0.05,
      eventLeadSeconds: 1.5,
      eventTailSeconds: 2.5,
      minimumDeadZoneSeconds: 0.25,
    });
  });

  // The moments have to be found in the audio, so a new Content SourceTrack is a new read. What is kept around
  // them is planning, like the Margin.
  test("a new Content SourceTrack needs a read, its EventLead and EventTail only a replan", () => {
    let session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));
    session = cutFinished(setSourceTrackRole(setSourceTrackRole(session, 4, "voice"), 2, "content"));

    expect(redoNeeded(session)).toBe("nothing");
    expect(redoNeeded(setSourceTrackRole(session, 1, "content"))).toBe("analyse");
    expect(redoNeeded(setSourceTrackRole(session, 2, "ignored"))).toBe("analyse");
    expect(redoNeeded(setEventLeadSeconds(session, 2))).toBe("replan");
    expect(redoNeeded(setEventTailSeconds(session, 3))).toBe("replan");
  });

  test("the event sliders stay inside their range", () => {
    const session = newCutSession();

    expect(setEventLeadSeconds(session, 9).eventLeadSeconds).toBe(5);
    expect(setEventLeadSeconds(session, -1).eventLeadSeconds).toBe(0);
    expect(setEventTailSeconds(session, 9).eventTailSeconds).toBe(5);
  });

  // A Preset is a named set of thresholds for a kind of video (CONTEXT.md). Gaming holds the settings the owner
  // arrived at by listening (ADR-0003); the others are a starting point, not a measurement.
  test("a Preset sets the sliders and leaves the roles alone", () => {
    let session = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));
    session = setSourceTrackRole(setSourceTrackRole(session, 4, "voice"), 2, "content");

    const gaming = PRESETS.find((preset) => preset.name === "Gaming");
    expect(gaming).toMatchObject({ thresholdDbfs: -40, marginSeconds: 0.05, minimumDeadZoneSeconds: 0.25 });

    const podcast = applyPreset(session, PRESETS.find((preset) => preset.name === "Podcast")!);

    expect(podcast.minimumDeadZoneSeconds).toBe(1.2);
    expect(podcast.marginSeconds).toBe(0.2);
    // Which SourceTrack carries what is a property of the Recording, not of the kind of video.
    expect(podcast.listenTo).toEqual([4]);
    expect(podcast.contentSourceTracks).toEqual([2]);
  });

  test("a SourceTrack given a role has to be read, so its waveform can be shown before any cut", () => {
    const chosen = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));

    expect(sourceTracksToRead(chosen, [])).toEqual([]);
    expect(sourceTracksToRead(setSourceTrackRole(chosen, 4, "voice"), [])).toEqual([4]);
  });

  // Reading a SourceTrack of a 2.5-hour Recording takes about a minute. Doing it twice for the same one, or
  // throwing it away because the user tried another role for a moment, would cost that minute for nothing.
  test("a SourceTrack that was already read is never read again", () => {
    const chosen = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));
    const listening = setSourceTrackRole(setSourceTrackRole(chosen, 4, "voice"), 2, "content");

    expect(sourceTracksToRead(listening, [])).toEqual([2, 4]);
    expect(sourceTracksToRead(listening, [4])).toEqual([2]);
    expect(sourceTracksToRead(listening, [2, 4])).toEqual([]);

    // Taking the role away again asks for nothing, and putting it back asks for nothing either: it is still read.
    const ignored = setSourceTrackRole(listening, 4, "ignored");
    expect(sourceTracksToRead(ignored, [2, 4])).toEqual([]);
    expect(sourceTracksToRead(setSourceTrackRole(ignored, 4, "voice"), [2, 4])).toEqual([]);
  });

  test("SourceTracks nobody gave a role are never read", () => {
    const chosen = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\obs.mp4`, 6));

    expect(sourceTracksToRead(setSourceTrackRole(chosen, 4, "ignored"), [])).toEqual([]);
  });

  test("a fresh session has the Gaming Preset chosen, with nothing changed on it yet", () => {
    expect(presetChoice(newCutSession(), [])).toEqual({ name: "Gaming", changed: false });
  });

  // The choice used to be deduced from the slider values, so one nudge made it jump to "eigene" and the user could
  // no longer delete or overwrite the Preset they were plainly working on.
  test("moving a slider marks the chosen Preset as changed instead of unchoosing it", () => {
    const abend: Preset = {
      name: "Abend",
      thresholdDbfs: -38,
      marginSeconds: 0.08,
      eventLeadSeconds: 1,
      eventTailSeconds: 1.5,
      minimumDeadZoneSeconds: 0.4,
    };
    const chosen = applyPreset(newCutSession(), abend);
    expect(presetChoice(chosen, [abend])).toEqual({ name: "Abend", changed: false });
    expect(chosen.marginSeconds).toBe(0.08);

    const nudged = setMarginSeconds(chosen, 0.42);
    expect(presetChoice(nudged, [abend])).toEqual({ name: "Abend", changed: true });

    // Choosing it again puts the sliders back and the mark goes away.
    expect(presetChoice(applyPreset(nudged, abend), [abend])).toEqual({ name: "Abend", changed: false });
  });

  test("a built-in Preset is marked changed the same way, so Gaming does not silently become something else", () => {
    expect(presetChoice(setThresholdDbfs(newCutSession(), -52), [])).toEqual({ name: "Gaming", changed: true });
  });

  // A guard: the sliders keep the deleted Preset's values, but nothing may still claim to be chosen — the window
  // would otherwise offer to delete a Preset that is already gone.
  test("deleting the chosen Preset leaves nothing chosen", () => {
    const abend: Preset = {
      name: "Abend",
      thresholdDbfs: -38,
      marginSeconds: 0.08,
      eventLeadSeconds: 1,
      eventTailSeconds: 1.5,
      minimumDeadZoneSeconds: 0.4,
    };
    const chosen = applyPreset(newCutSession(), abend);

    expect(presetChoice(chosen, [])).toBe(null);
    expect(chosen.marginSeconds).toBe(0.08);
  });
});
