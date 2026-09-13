import { describe, expect, test } from "vitest";
import type { TimeRange } from "../cutting/planCuts";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import type { TrimProject } from "../project/trimProject";
import {
  chooseRecording,
  markLockedRangeEnd,
  markLockedRangeStart,
  newCutSession,
  projectOpened,
  projectSaved,
  removeLockedRange,
  savedChoicesFrom,
  setSourceTrackRole,
} from "./cutSession";
import type { SourceTrackScan } from "../scan/scanSourceTracks";
import {
  askBeforeClosing,
  jobRefused,
  nextBackgroundJob,
  roleGiven,
  projectAudioArrived,
  projectTab,
  readArrived,
  recordingTab,
  scanArrived,
  viewedAfterClosing,
  type TabWork,
} from "./tabs";

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
function probed(path: string, sourceTracks = 2): RecordingInfo {
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

/** A saved project of the long Recording cut by SourceTrack 1, holding `lockedRanges`. */
function projectHolding(lockedRanges: readonly TimeRange[]): TrimProject {
  return {
    recording: probed(String.raw`C:\Aufnahmen\long-recording.mp4`),
    listenTo: [0],
    exportSourceTracks: [0, 1],
    decideBy: { kind: "loudness", thresholdDbfs: -40 },
    marginSeconds: 0.05,
    minimumDeadZoneSeconds: 0.25,
    worthKeeping: [],
    lockedRanges: [...lockedRanges],
  };
}

// The rules of the Tab strip in the window: which Tab is on screen, when closing asks first, and which Tab's
// SourceTracks are read next (ADR-0025).
describe("tabs", () => {
  test("closing the Tab on screen shows its right neighbour, else its left one, else none", () => {
    const open = [1, 2, 3];

    expect(viewedAfterClosing(open, 2, 2)).toBe(3);
    expect(viewedAfterClosing(open, 3, 3)).toBe(2);
    expect(viewedAfterClosing([1], 1, 1)).toBe(null);
    // A Tab closed in the background leaves the one on screen where it is.
    expect(viewedAfterClosing(open, 1, 3)).toBe(3);
  });

  // Held stretches are the one piece of work in a Tab that no slider can bring back (ADR-0023).
  test("closing asks first only while a held stretch is in no saved project", () => {
    const opened = chooseRecording(newCutSession(), probed(String.raw`C:\Aufnahmen\long-recording.mp4`));
    const held = markLockedRangeEnd(markLockedRangeStart(opened, 10), 20);
    const savedChoices = savedChoicesFrom(held);

    expect(askBeforeClosing(opened)).toBe(false);
    expect(askBeforeClosing(held)).toBe(true);
    // A Premiere file cannot be opened again, so only the project counts as saved.
    expect(askBeforeClosing(projectSaved(held, savedChoices))).toBe(false);
    // Holding another stretch after saving is unsaved work again; letting one go loses nothing the project lacks.
    const heldMore = markLockedRangeEnd(markLockedRangeStart(projectSaved(held, savedChoices), 30), 40);
    expect(askBeforeClosing(heldMore)).toBe(true);
    expect(askBeforeClosing(removeLockedRange(projectSaved(held, savedChoices), 0))).toBe(false);
    // A reopened project has saved exactly what it holds.
    expect(askBeforeClosing(projectOpened(newCutSession(), projectHolding([{ startSeconds: 10, endSeconds: 20 }])))).toBe(
      false,
    );
  });

  // Reading one Recording takes up to half a minute and all of ffmpeg; the owner chose one Recording after another.
  test("the Tab on screen is scanned and read first, then every other Tab is scanned, then read from the left", () => {
    let tabs: TabWork[] = [
      recordingTab(1, probed(String.raw`C:\Aufnahmen\Part1.mp4`)),
      recordingTab(2, probed(String.raw`C:\Aufnahmen\Part2.mp4`)),
      projectTab(3, projectHolding([])),
    ];
    const update = (id: number, change: (tab: TabWork) => TabWork) => {
      tabs = tabs.map((tab) => (tab.id === id ? change(tab) : tab));
    };
    const firstCarriesSound = scanned([true, false]);

    // Part2 is on screen, since it was opened last.
    expect(nextBackgroundJob(tabs, 2)).toEqual({ kind: "scan", tabId: 2 });
    update(2, (tab) => scanArrived(tab, firstCarriesSound));
    // Only what the scan found sound on is read ahead.
    expect(nextBackgroundJob(tabs, 2)).toEqual({ kind: "read", tabId: 2, positions: [0] });
    update(2, (tab) => readArrived(tab, [0]));
    // A project needs no scan: it saved its own.
    expect(nextBackgroundJob(tabs, 2)).toEqual({ kind: "scan", tabId: 1 });
    update(1, (tab) => scanArrived(tab, firstCarriesSound));
    // The user looks at the project meanwhile, so its SourceTracks come before Part1's.
    expect(nextBackgroundJob(tabs, 3)).toEqual({ kind: "projectAudio", tabId: 3 });
    update(3, (tab) => projectAudioArrived(tab, [0]));
    expect(nextBackgroundJob(tabs, 3)).toEqual({ kind: "read", tabId: 1, positions: [0] });
    update(1, (tab) => readArrived(tab, [0]));
    expect(nextBackgroundJob(tabs, 3)).toBe(null);
  });

  // Asked again at once, a refused read would start one ffmpeg on a 23 GB file per turn, for ever (ADR-0020).
  test("a Tab whose job was refused gets no more until the user gives one of its SourceTracks a role", () => {
    let tabs: TabWork[] = [
      scanArrived(recordingTab(1, probed(String.raw`C:\Aufnahmen\Part1.mp4`)), scanned([true, true])),
      recordingTab(2, probed(String.raw`C:\Aufnahmen\Part2.mp4`)),
    ];
    const update = (id: number, change: (tab: TabWork) => TabWork) => {
      tabs = tabs.map((tab) => (tab.id === id ? change(tab) : tab));
    };

    expect(nextBackgroundJob(tabs, 1)).toEqual({ kind: "read", tabId: 1, positions: [0, 1] });
    update(1, jobRefused);
    // The other Tab carries on.
    expect(nextBackgroundJob(tabs, 1)).toEqual({ kind: "scan", tabId: 2 });
    update(2, (tab) => scanArrived(tab, scanned([false, false])));
    expect(nextBackgroundJob(tabs, 1)).toBe(null);

    // A role is the user asking for that SourceTrack: it is tried again, and only it — not the whole read-ahead.
    update(1, (tab) => roleGiven(tab, setSourceTrackRole(tab.session, 1, "voice")));
    expect(nextBackgroundJob(tabs, 1)).toEqual({ kind: "read", tabId: 1, positions: [1] });
  });
});
