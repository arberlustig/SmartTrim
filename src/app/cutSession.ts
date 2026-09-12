import type { AnalysisRequest } from "../analysis/analyseRecording.ts";
import type { PlanSettings } from "./runCut.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import type { SourceTrackScan } from "../scan/scanSourceTracks.ts";

/** What one slider can be set to. `step` is what the window moves by, not something this module enforces. */
export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

/**
 * The three sliders. Their ends are judgement, not measurement: below -60 dBFS a threshold sits in the noise floor,
 * a Margin over a second stops removing anything, and a MinimumDeadZone under 0.1 s cuts between breaths and blows
 * the exported XML up into thousands of KeepSegments. The window reads these so its sliders cannot leave the range.
 */
export const THRESHOLD_DBFS: SliderRange = { min: -60, max: -20, step: 1 };
export const MARGIN_SECONDS: SliderRange = { min: 0, max: 1, step: 0.01 };
export const MINIMUM_DEAD_ZONE_SECONDS: SliderRange = { min: 0.1, max: 5, step: 0.05 };

/** Keeps a slider value inside its range and off floating-point noise like 0.15000000000000002. */
function clamp(value: number, range: SliderRange): number {
  if (!Number.isFinite(value)) throw new Error(`${value} is not a slider value.`);
  return Number(Math.min(Math.max(value, range.min), range.max).toFixed(3));
}

/**
 * Everything the window remembers. It is replaced, never mutated, so the renderer can redraw from one value and the
 * rules below stay testable without Electron.
 */
export interface CutSession {
  /** The Recording as probed, or null while none is chosen. */
  recording: RecordingInfo | null;
  /** What a scan found on the Recording's SourceTracks, or null while nothing was measured. */
  scan: readonly SourceTrackScan[] | null;
  /** Whether the SourceTracks the scan found nothing on are shown anyway. */
  emptySourceTracksShown: boolean;
  /** The SourceTracks the user ticked, by position in the Recording, 0 being the first: they decide what is kept. */
  listenTo: readonly number[];
  /**
   * The SourceTracks that end up in the Premiere sequence, by position. A freshly chosen Recording has every
   * SourceTrack in here that a scan found sound on, or all of them where no scan looked: what is cut by and what is
   * exported are two different choices (ADR-0014).
   */
  exportSourceTracks: readonly number[];
  /** The settings the cut on screen was made with, or null while there is none. */
  plannedWith: PlannedWith | null;
  thresholdDbfs: number;
  marginSeconds: number;
  minimumDeadZoneSeconds: number;
}

/** The settings a finished cut belongs to, so the window can tell what a change costs. */
interface PlannedWith {
  listenTo: readonly number[];
  thresholdDbfs: number;
  marginSeconds: number;
  minimumDeadZoneSeconds: number;
}

/** What has to happen before the cut on screen matches the settings again. */
export type Redo = "nothing" | "replan" | "redecide" | "analyse";

/** A session on the settings the owner chose after listening to the alternatives (ADR-0003). */
export function newCutSession(): CutSession {
  return {
    recording: null,
    scan: null,
    emptySourceTracksShown: false,
    listenTo: [],
    exportSourceTracks: [],
    plannedWith: null,
    thresholdDbfs: -40,
    marginSeconds: 0.05,
    minimumDeadZoneSeconds: 0.25,
  };
}

/**
 * Chooses a probed Recording, with what a scan found on its SourceTracks when that is known. Ticks from the previous
 * Recording are dropped: its SourceTracks are gone with it.
 */
export function chooseRecording(
  session: CutSession,
  recording: RecordingInfo,
  scan: readonly SourceTrackScan[] | null = null,
): CutSession {
  return {
    ...session,
    recording,
    scan,
    emptySourceTracksShown: false,
    listenTo: [],
    // Another Recording means the cut on screen belongs to nothing that is still chosen.
    plannedWith: null,
    // What the window shows is what it exports: a SourceTrack hidden as an EmptyTrack would otherwise arrive in
    // Premiere with a tick nobody can see (ADR-0014). Where no scan looked, nothing is dropped.
    exportSourceTracks: recording.sourceTracks
      .map((_sourceTrack, position) => position)
      .filter((position) => !scan || scan[position]?.carriesSound !== false),
  };
}

/**
 * The SourceTracks the window draws, by position. EmptyTracks are left out (CONTEXT.md) — but only where a scan
 * actually looked: without one, nothing is known and nothing may be hidden.
 */
export function visibleSourceTracks(session: CutSession): readonly number[] {
  const positions = session.recording?.sourceTracks.map((_sourceTrack, position) => position) ?? [];
  const { scan } = session;
  if (!scan || session.emptySourceTracksShown) return positions;
  return positions.filter((position) => scan[position]?.carriesSound !== false);
}

/**
 * Shows or hides the SourceTracks the scan found nothing on. A scan only listens to slices, so a SourceTrack that
 * speaks up between them looks empty and the user has to be able to reach it. Ticks are left as they are.
 */
export function revealEmptySourceTracks(session: CutSession, shown: boolean): CutSession {
  return { ...session, emptySourceTracksShown: shown };
}

/** Ticks or unticks one SourceTrack by its position in the Recording. */
export function toggleSourceTrack(session: CutSession, sourceTrackIndex: number): CutSession {
  // A position without a SourceTrack behind it would reach the decoder as an ffmpeg stream that does not exist.
  if (!session.recording) throw new Error("No Recording is chosen, so it has no SourceTracks to listen to.");
  const { sourceTracks } = session.recording;
  if (sourceTrackIndex < 0 || sourceTrackIndex >= sourceTracks.length) {
    throw new Error(
      `SourceTrack ${sourceTrackIndex + 1} does not exist: the Recording has ${sourceTracks.length}.`,
    );
  }
  const ticked = session.listenTo.includes(sourceTrackIndex);
  const listenTo = ticked
    ? session.listenTo.filter((index) => index !== sourceTrackIndex)
    // Kept in the Recording's own order so the analysis reads the SourceTracks front to back.
    : [...session.listenTo, sourceTrackIndex].sort((left, right) => left - right);
  return { ...session, listenTo };
}

/** Whether Schneiden can be pressed. */
export function canCut(session: CutSession): boolean {
  return session.recording !== null && session.listenTo.length > 0;
}

/** Loudness above this threshold in dBFS decides what is kept — the owner's choice (ADR-0003). */
export function setThresholdDbfs(session: CutSession, thresholdDbfs: number): CutSession {
  return { ...session, thresholdDbfs: clamp(thresholdDbfs, THRESHOLD_DBFS) };
}

/** Time kept on each side of what is worth keeping, so a cut does not clip a word. */
export function setMarginSeconds(session: CutSession, marginSeconds: number): CutSession {
  return { ...session, marginSeconds: clamp(marginSeconds, MARGIN_SECONDS) };
}

/** How long a DeadZone must last, after the Margin, before it is removed (ADR-0007). */
export function setMinimumDeadZoneSeconds(session: CutSession, minimumDeadZoneSeconds: number): CutSession {
  return { ...session, minimumDeadZoneSeconds: clamp(minimumDeadZoneSeconds, MINIMUM_DEAD_ZONE_SECONDS) };
}

/** What the user's choices ask the analysis to do. Refused while the window could not press Schneiden. */
export function analysisRequestFrom(session: CutSession): AnalysisRequest {
  if (!session.recording) throw new Error("Choose a Recording first.");
  if (session.listenTo.length === 0) throw new Error("Tick at least one SourceTrack to listen to.");
  return {
    recordingPath: session.recording.path,
    voiceSourceTracks: [...session.listenTo],
    decideBy: { kind: "loudness", thresholdDbfs: session.thresholdDbfs },
    marginSeconds: session.marginSeconds,
    minimumDeadZoneSeconds: session.minimumDeadZoneSeconds,
  };
}

/** Takes one SourceTrack out of the Premiere sequence, or puts it back. It has no say in what is cut. */
export function toggleExportSourceTrack(session: CutSession, sourceTrackIndex: number): CutSession {
  if (!session.recording) throw new Error("No Recording is chosen, so it has no SourceTracks to export.");
  const { sourceTracks } = session.recording;
  if (sourceTrackIndex < 0 || sourceTrackIndex >= sourceTracks.length) {
    throw new Error(`SourceTrack ${sourceTrackIndex + 1} does not exist: the Recording has ${sourceTracks.length}.`);
  }
  const exportSourceTracks = session.exportSourceTracks.includes(sourceTrackIndex)
    ? session.exportSourceTracks.filter((position) => position !== sourceTrackIndex)
    : [...session.exportSourceTracks, sourceTrackIndex].sort((left, right) => left - right);
  return { ...session, exportSourceTracks };
}

/** Whether the Premiere file can be written: a sequence without any audio looks like an edit that lost its sound. */
export function canExport(session: CutSession): boolean {
  return session.exportSourceTracks.length > 0;
}

/** Remembers that the cut on screen was planned with the settings as they are now. */
export function cutFinished(session: CutSession): CutSession {
  return {
    ...session,
    plannedWith: {
      listenTo: [...session.listenTo],
      thresholdDbfs: session.thresholdDbfs,
      marginSeconds: session.marginSeconds,
      minimumDeadZoneSeconds: session.minimumDeadZoneSeconds,
    },
  };
}

/** The two settings a replan needs; the rest of a request decides what was found, not how it is planned. */
export function planSettingsFrom(session: CutSession): PlanSettings {
  return { marginSeconds: session.marginSeconds, minimumDeadZoneSeconds: session.minimumDeadZoneSeconds };
}

/**
 * What the window has to do before its numbers match the settings, in order of what it costs (ADR-0004):
 *
 * - `replan`: Margin or MinimumDeadZone moved. The cuts are planned again around what was already found.
 * - `redecide`: the threshold moved. The decoded audio is still in memory, so what is worth keeping is decided
 *   again from it — still without touching the Recording.
 * - `analyse`: another SourceTrack was ticked. That is audio nobody has decoded yet, so the Recording is read.
 */
export function redoNeeded(session: CutSession): Redo {
  const planned = session.plannedWith;
  if (!planned) return "analyse";
  const sameSourceTracks =
    planned.listenTo.length === session.listenTo.length &&
    planned.listenTo.every((position, index) => position === session.listenTo[index]);
  if (!sameSourceTracks) return "analyse";
  // Deciding again plans as well, so a threshold that moved together with a Margin is still one job.
  if (planned.thresholdDbfs !== session.thresholdDbfs) return "redecide";
  if (
    planned.marginSeconds !== session.marginSeconds ||
    planned.minimumDeadZoneSeconds !== session.minimumDeadZoneSeconds
  ) {
    return "replan";
  }
  return "nothing";
}
