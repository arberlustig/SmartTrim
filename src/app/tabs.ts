import type { TimeRange } from "../cutting/planCuts.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import type { TrimProject } from "../project/trimProject.ts";
import type { SourceTrackScan } from "../scan/scanSourceTracks.ts";
import {
  audioBackInMemory,
  chooseRecording,
  newCutSession,
  projectOpened,
  scanFinished,
  sourceTracksToRead,
  type CutSession,
} from "./cutSession.ts";

/** What the window keeps of one Tab that decides what runs in the background for it. */
export interface TabWork {
  readonly id: number;
  readonly session: CutSession;
  /** The SourceTracks whose waveform the window has, by position. */
  readonly read: readonly number[];
  /** The SourceTracks to read before anyone asks: every one the scan found sound on (ADR-0020). */
  readonly readAhead: readonly number[];
  /** A Recording is scanned once, before its SourceTracks are read; a project saved its scan. */
  readonly scanPending: boolean;
  /** A reopened project has to read its audio again before its waveform can be drawn (ADR-0016). */
  readonly projectAudioPending: boolean;
  /** A job for this Tab was refused, so nothing more runs for it until the user asks for a SourceTrack. */
  readonly stalled: boolean;
}

/** One job the window runs in the background. Only one runs at a time, across every Tab. */
export type BackgroundJob =
  | { kind: "scan"; tabId: number }
  | { kind: "projectAudio"; tabId: number }
  | { kind: "read"; tabId: number; positions: readonly number[] };

/** A Tab for a freshly opened Recording, on the owner's settings: it is scanned first, then read. */
export function recordingTab(id: number, recording: RecordingInfo): TabWork {
  return {
    id,
    session: chooseRecording(newCutSession(), recording),
    read: [],
    readAhead: [],
    scanPending: true,
    projectAudioPending: false,
    stalled: false,
  };
}

/** A Tab for a reopened project, which comes with its scan and cut but without its audio. */
export function projectTab(id: number, project: TrimProject): TabWork {
  return {
    id,
    session: projectOpened(newCutSession(), project),
    read: [],
    readAhead: [],
    scanPending: false,
    projectAudioPending: true,
    stalled: false,
  };
}

/** What a Tab still needs reading, in the Recording's order: SourceTracks with a role, then those read ahead. */
function stillToRead(tab: TabWork): number[] {
  const wanted = [...sourceTracksToRead(tab.session, tab.read), ...tab.readAhead.filter((one) => !tab.read.includes(one))];
  return [...new Set(wanted)].sort((one, other) => one - other);
}

/** The slow job a Tab waits for, once it is scanned: its project's audio, or its SourceTracks. */
function readingJob(tab: TabWork): BackgroundJob | null {
  if (tab.projectAudioPending) return { kind: "projectAudio", tabId: tab.id };
  const positions = stillToRead(tab);
  return positions.length > 0 ? { kind: "read", tabId: tab.id, positions } : null;
}

/**
 * What to run next in the background, or nothing. The Tab on screen goes first, scan and read, since that is where
 * the user is waiting. Then every other Tab is scanned, which takes seconds and hides their EmptyTracks, before any
 * of them is read, which takes up to half a minute each: one Recording after another, from the left (ADR-0025).
 */
export function nextBackgroundJob(allTabs: readonly TabWork[], viewed: number | null): BackgroundJob | null {
  const tabs = allTabs.filter((tab) => !tab.stalled);
  const onScreen = tabs.find((tab) => tab.id === viewed);
  if (onScreen) {
    if (onScreen.scanPending) return { kind: "scan", tabId: onScreen.id };
    const job = readingJob(onScreen);
    if (job) return job;
  }
  const others = tabs.filter((tab) => tab !== onScreen);
  const unscanned = others.find((tab) => tab.scanPending);
  if (unscanned) return { kind: "scan", tabId: unscanned.id };
  for (const tab of others) {
    const job = readingJob(tab);
    if (job) return job;
  }
  return null;
}

/** A scan came back: EmptyTracks are hidden, and every SourceTrack it found sound on is to be read ahead. */
export function scanArrived(tab: TabWork, scan: readonly SourceTrackScan[]): TabWork {
  return {
    ...tab,
    session: scanFinished(tab.session, scan),
    scanPending: false,
    readAhead: scan.flatMap((sourceTrack, position) => (sourceTrack.carriesSound ? [position] : [])),
  };
}

/**
 * A job for this Tab was refused. Nothing more runs for it: asked again at once, the same request would be refused
 * again, one ffmpeg after another. What it was to read ahead is forgotten, and the refusal is on screen.
 */
export function jobRefused(tab: TabWork): TabWork {
  return { ...tab, stalled: true, readAhead: [], scanPending: false, projectAudioPending: false };
}

/**
 * The user gave a SourceTrack of this Tab a role, with `session` the result. That is asking for its waveform, so a
 * Tab stalled by a refusal is tried again — for the SourceTracks with a role, not for the read-ahead it gave up.
 */
export function roleGiven(tab: TabWork, session: CutSession): TabWork {
  return { ...tab, session, stalled: false };
}

/** SourceTracks came back read: their waveforms are in the window. */
export function readArrived(tab: TabWork, positions: readonly number[]): TabWork {
  return { ...tab, read: [...new Set([...tab.read, ...positions])] };
}

/**
 * A reopened project's audio came back: its waveforms are in the window, and a new threshold can be decided from
 * memory again. Not `cutFinished`: a slider moved while it was read still needs its plan redone (ADR-0020).
 */
export function projectAudioArrived(tab: TabWork, positions: readonly number[]): TabWork {
  return {
    ...tab,
    session: audioBackInMemory(tab.session),
    projectAudioPending: false,
    read: [...new Set([...tab.read, ...positions])],
  };
}

/** The held stretches that lie inside none of the stretches the last saved or opened project holds. */
export function unsavedLockedRanges(session: CutSession): TimeRange[] {
  return session.lockedRanges.filter(
    (held) =>
      !session.lockedRangesSaved.some(
        (saved) => saved.startSeconds <= held.startSeconds && held.endSeconds <= saved.endSeconds,
      ),
  );
}

/**
 * Whether closing a Tab would throw away a held stretch that no saved project holds. Sliders, roles and a cut can all
 * be set again in seconds; a moment found by listening cannot.
 */
export function askBeforeClosing(session: CutSession): boolean {
  return unsavedLockedRanges(session).length > 0;
}

/**
 * The Tab on screen once `closing` is gone: the one that was on screen, unless that is the one closing — then its
 * right neighbour, which slides into the place the eye is already on, else its left one, else none.
 */
export function viewedAfterClosing(open: readonly number[], closing: number, viewed: number | null): number | null {
  if (closing !== viewed) return viewed;
  const at = open.indexOf(closing);
  return open[at + 1] ?? open[at - 1] ?? null;
}
