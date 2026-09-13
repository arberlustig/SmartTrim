import { describe, expect, test } from "vitest";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import {
  applyPreset,
  chooseRecording,
  cutFinished,
  markLockedRangeEnd,
  markLockedRangeStart,
  newCutSession,
  PRESETS,
  scanFinished,
  setMarginSeconds,
  setSourceTrackRole,
  toggleExportSourceTrack,
  type CutSession,
} from "./cutSession";
import type { SourceTrackScan } from "../scan/scanSourceTracks";
import { cuttingAllDoes, savingAllDoes, settingsCopied } from "./allTabs";

/** A scan saying which SourceTracks carried sound, the way `scanSourceTracks` reports it. */
function scanned(carriesSound: readonly boolean[]): SourceTrackScan[] {
  return carriesSound.map((sound) => ({
    carriesSound: sound,
    peakDbfs: sound ? -12 : -Infinity,
    slicesWithSound: sound ? 5 : 0,
    sliceCount: 5,
  }));
}

/** A probed Recording of 100 s with `sourceTracks` stereo SourceTracks. */
function probed(path: string, sourceTracks: number): RecordingInfo {
  return {
    path,
    frameRate: { numerator: 60, denominator: 1 },
    width: 1920,
    height: 1080,
    durationFrames: 6000,
    sourceTracks: Array.from({ length: sourceTracks }, () => ({
      channelCount: 2,
      sampleRate: 48000,
      bitDepth: 16,
      durationFrames: 6000,
    })),
  };
}

/** A session on `path` with `sourceTracks` SourceTracks, nothing changed yet. */
function opened(path: string, sourceTracks: number): CutSession {
  return chooseRecording(newCutSession(), probed(path, sourceTracks));
}

// "Für alle übernehmen" and "Alle schneiden": what one Tab hands to the others, and what each Tab does when all are cut.
describe("all Tabs", () => {
  test("taking over the sliders brings the thresholds and the chosen Preset, never the roles or the held stretches", () => {
    const podcast = PRESETS.find((preset) => preset.name === "Podcast");
    if (!podcast) throw new Error("Podcast is a built-in Preset.");
    const from = setMarginSeconds(applyPreset(opened(String.raw`C:\Aufnahmen\Part1.mp4`, 6), podcast), 0.4);
    const to = markLockedRangeEnd(
      markLockedRangeStart(setSourceTrackRole(opened(String.raw`C:\Aufnahmen\Part2.mp4`, 6), 4, "voice"), 10),
      20,
    );

    const { session, rolesLeftOut } = settingsCopied(from, to, "sliders");

    expect(session).toEqual({
      ...to,
      selectedPreset: "Podcast",
      thresholdDbfs: -45,
      marginSeconds: 0.4,
      eventLeadSeconds: 0,
      eventTailSeconds: 0,
      minimumDeadZoneSeconds: 1.2,
    });
    expect(rolesLeftOut).toBe(false);
  });

  // The owner's captures all come from one OBS setup, so SourceTrack 5 is the microphone in every one of them.
  test("taking over the roles as well brings what each SourceTrack does and whether it goes to Premiere", () => {
    let from = opened(String.raw`C:\Aufnahmen\Part1.mp4`, 6);
    from = setSourceTrackRole(setSourceTrackRole(from, 4, "voice"), 2, "content");
    from = toggleExportSourceTrack(toggleExportSourceTrack(from, 1), 5);
    // Part2's scan heard nothing on SourceTracks 3 and 4, so they are hidden there.
    const held = markLockedRangeEnd(markLockedRangeStart(opened(String.raw`C:\Aufnahmen\Part2.mp4`, 6), 10), 20);
    const to = scanFinished(setSourceTrackRole(held, 0, "voice"), scanned([true, true, false, false, true, true]));

    const { session, rolesLeftOut } = settingsCopied(from, to, "slidersAndRoles");

    expect(rolesLeftOut).toBe(false);
    expect([session.listenTo, session.contentSourceTracks, session.exportSourceTracks]).toEqual([[4], [2], [0, 2, 3, 4]]);
    expect(session.lockedRanges).toEqual([{ startSeconds: 10, endSeconds: 20 }]);
    // SourceTrack 3 now decides what is kept, and nothing that decides may be out of sight.
    expect(session.emptySourceTracksShown).toBe(true);
    // Where no role lands on a hidden SourceTrack, they stay hidden — and out of Premiere, which no tick taken over may
    // change: a hidden SourceTrack must not arrive in the sequence with a tick nobody can see (ADR-0014).
    const voiceOnly = settingsCopied(setSourceTrackRole(from, 2, "ignored"), to, "slidersAndRoles").session;
    expect(voiceOnly.emptySourceTracksShown).toBe(false);
    expect(voiceOnly.exportSourceTracks).toEqual([0, 4]);
  });

  test("a Recording with another number of SourceTracks takes over the sliders only, and says so", () => {
    const from = setMarginSeconds(setSourceTrackRole(opened(String.raw`C:\Aufnahmen\Part1.mp4`, 6), 4, "voice"), 0.4);
    const to = setSourceTrackRole(opened(String.raw`C:\Aufnahmen\Handy.mp4`, 2), 1, "voice");

    const { session, rolesLeftOut } = settingsCopied(from, to, "slidersAndRoles");

    expect(rolesLeftOut).toBe(true);
    expect(session).toEqual({ ...to, marginSeconds: 0.4 });
  });

  // "Alle schneiden" only cuts, so the waveforms show each Tab's cut; saving is a button of its own (owner, 2026-09-13).
  test("cutting all Tabs cuts each one on its own settings, leaves a cut that already matches them, and passes over a Tab with nothing to cut by", () => {
    const withVoice = setSourceTrackRole(opened(String.raw`C:\Aufnahmen\Part1.mp4`, 2), 0, "voice");
    const cut = cutFinished(withVoice);

    expect(cuttingAllDoes(withVoice, false)).toBe("cut");
    expect(cuttingAllDoes(cut, true)).toBe("nothing");
    // A slider moved since, or a cut the window no longer holds — refused, say — is cut again.
    expect(cuttingAllDoes(setMarginSeconds(cut, 0.4), true)).toBe("cut");
    expect(cuttingAllDoes(cut, false)).toBe("cut");
    expect(cuttingAllDoes(opened(String.raw`C:\Aufnahmen\Part2.mp4`, 2), false)).toBe("skipNoVoice");
    // What goes to Premiere is a matter for saving, not for cutting.
    const nothingExported = toggleExportSourceTrack(toggleExportSourceTrack(withVoice, 0), 1);
    expect(cuttingAllDoes(nothingExported, false)).toBe("cut");
  });

  test("saving all Premiere files saves only a cut that matches its settings, and passes over the rest with their reason", () => {
    const withVoice = setSourceTrackRole(opened(String.raw`C:\Aufnahmen\Part1.mp4`, 2), 0, "voice");
    const cut = cutFinished(withVoice);

    expect(savingAllDoes(cut, true)).toBe("save");
    // Saving never cuts: a Tab without a cut, or with settings its cut no longer matches, has to be cut first.
    expect(savingAllDoes(withVoice, false)).toBe("skipNotCut");
    expect(savingAllDoes(setMarginSeconds(cut, 0.4), true)).toBe("skipNotCut");
    expect(savingAllDoes(cut, false)).toBe("skipNotCut");
    // A sequence without a single SourceTrack would look like an edit that lost its sound.
    const nothingExported = toggleExportSourceTrack(toggleExportSourceTrack(cut, 0), 1);
    expect(savingAllDoes(nothingExported, true)).toBe("skipNoExport");
  });
});
