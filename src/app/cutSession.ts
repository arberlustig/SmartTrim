import type { AnalysisRequest } from "../analysis/analyseRecording.ts";
import { normalisedLockedRanges } from "../cutting/lockedRanges.ts";
import type { TimeRange } from "../cutting/planCuts.ts";
import type { SavedChoices } from "../project/openTrimProject.ts";
import type { TrimProject } from "../project/trimProject.ts";
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
/** Kept before and after a ContentEvent, in place of the Margin. Five seconds of run-up is still an edit. */
export const EVENT_LEAD_SECONDS: SliderRange = { min: 0, max: 5, step: 0.1 };
export const EVENT_TAIL_SECONDS: SliderRange = { min: 0, max: 5, step: 0.1 };

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
  /** The Voice SourceTracks by position in the Recording, 0 being the first: they decide what is kept. */
  listenTo: readonly number[];
  /** The Content SourceTracks: their moments keep material alive, their steady level does not matter. */
  contentSourceTracks: readonly number[];
  /**
   * The SourceTracks that end up in the Premiere sequence, by position. A freshly chosen Recording has every
   * SourceTrack in here that a scan found sound on, or all of them where no scan looked: what is cut by and what is
   * exported are two different choices (ADR-0014).
   */
  exportSourceTracks: readonly number[];
  /** The settings the cut on screen was made with, or null while there is none. */
  plannedWith: PlannedWith | null;
  /**
   * Whether what a new threshold is decided from is in memory — each Voice SourceTrack's chunk levels, not its audio
   * (ADR-0021). It is after an analysis, and it is not after a saved project was reopened until its SourceTracks are
   * read again: a project holds what the analysis found, not what it was found in (ADR-0004).
   */
  audioInMemory: boolean;
  /**
   * The name of the Preset the user last picked, whether or not the sliders still match it. Remembered rather than
   * worked out from the slider values, so that moving one slider does not take the choice away from under the user
   * — the window says "Abend (geändert)" and can still offer to delete or overwrite Abend (ADR-0018).
   */
  selectedPreset: string | null;
  thresholdDbfs: number;
  marginSeconds: number;
  eventLeadSeconds: number;
  eventTailSeconds: number;
  minimumDeadZoneSeconds: number;
  /** The stretches the user marked to keep whatever the sliders say (CONTEXT.md), in order. */
  lockedRanges: readonly TimeRange[];
  /** Where "Anfang festhalten" was pressed, while its "Ende festhalten" has not come yet. */
  lockedRangeStart: number | null;
}

/** The settings a finished cut belongs to, so the window can tell what a change costs. */
interface PlannedWith {
  listenTo: readonly number[];
  contentSourceTracks: readonly number[];
  thresholdDbfs: number;
  marginSeconds: number;
  eventLeadSeconds: number;
  eventTailSeconds: number;
  minimumDeadZoneSeconds: number;
  lockedRanges: readonly TimeRange[];
}

/** A named set of thresholds for one kind of video (CONTEXT.md). The TrackRoles are not in it: which
 * SourceTrack carries the microphone is a property of the Recording and its OBS setup, not of the kind of video.
 */
export interface Preset {
  name: string;
  thresholdDbfs: number;
  marginSeconds: number;
  eventLeadSeconds: number;
  eventTailSeconds: number;
  minimumDeadZoneSeconds: number;
}

/**
 * Gaming holds what the owner arrived at by listening to the alternatives (ADR-0003), and is what a fresh session
 * starts on. The other two are a starting point and nothing more: nobody has judged them by ear yet (ADR-0017).
 */
export const PRESETS: readonly Preset[] = [
  // Talking over a game: cut close, because the owner speaks most of the time anyway.
  { name: "Gaming", thresholdDbfs: -40, marginSeconds: 0.05, eventLeadSeconds: 1.5, eventTailSeconds: 2, minimumDeadZoneSeconds: 0.25 },
  // Watching something and reacting: leave the reacted-to video room to breathe, and keep longer run-ups.
  { name: "Reaction", thresholdDbfs: -45, marginSeconds: 0.15, eventLeadSeconds: 2, eventTailSeconds: 2.5, minimumDeadZoneSeconds: 0.8 },
  // Two people talking: only the long pauses go, and there are no moments to keep.
  { name: "Podcast", thresholdDbfs: -45, marginSeconds: 0.2, eventLeadSeconds: 0, eventTailSeconds: 0, minimumDeadZoneSeconds: 1.2 },
];

/** What a SourceTrack contributes to the cutting decision. Exactly one of these (CONTEXT.md). */
export type TrackRole = "voice" | "content" | "ignored";

/** What has to happen before the cut on screen matches the settings again. */
export type Redo = "nothing" | "replan" | "redecide" | "analyse";

/** A session on the settings the owner chose after listening to the alternatives (ADR-0003). */
export function newCutSession(): CutSession {
  return {
    recording: null,
    scan: null,
    emptySourceTracksShown: false,
    listenTo: [],
    contentSourceTracks: [],
    exportSourceTracks: [],
    plannedWith: null,
    audioInMemory: false,
    // The owner's settings are the Gaming Preset, so a fresh session is on it rather than on nothing.
    selectedPreset: "Gaming",
    thresholdDbfs: -40,
    marginSeconds: 0.05,
    // Provisional, like the ContentEvent thresholds themselves: a second and a half of run-up and two seconds
    // after are what a bang needs to read as one, and nobody has judged them by ear yet (ADR-0017).
    eventLeadSeconds: 1.5,
    eventTailSeconds: 2,
    minimumDeadZoneSeconds: 0.25,
    lockedRanges: [],
    lockedRangeStart: null,
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
    contentSourceTracks: [],
    // Another Recording means the cut on screen belongs to nothing that is still chosen.
    plannedWith: null,
    audioInMemory: false,
    // A held stretch is a moment in the old Recording; at that moment the new one holds something else entirely.
    lockedRanges: [],
    lockedRangeStart: null,
    // What the window shows is what it exports: a SourceTrack hidden as an EmptyTrack would otherwise arrive in
    // Premiere with a tick nobody can see (ADR-0014). Where no scan looked, nothing is dropped.
    exportSourceTracks: recording.sourceTracks
      .map((_sourceTrack, position) => position)
      .filter((position) => !scan || scan[position]?.carriesSound !== false),
  };
}

/**
 * What a scan found, arriving after its Recording is already on screen. The rows are shown while the slices are
 * measured, so only the scan's own consequences follow: SourceTracks it found nothing on are hidden and leave the
 * export. Roles and ticks the user set meanwhile stay as they are.
 */
export function scanFinished(session: CutSession, scan: readonly SourceTrackScan[]): CutSession {
  return {
    ...session,
    scan,
    exportSourceTracks: session.exportSourceTracks.filter((position) => scan[position]?.carriesSound !== false),
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

/** What one SourceTrack contributes: nothing, the cutting decision, or its moments. */
export function roleOf(session: CutSession, sourceTrackIndex: number): TrackRole {
  if (session.listenTo.includes(sourceTrackIndex)) return "voice";
  if (session.contentSourceTracks.includes(sourceTrackIndex)) return "content";
  return "ignored";
}

/** Kept in the Recording's own order so the analysis reads the SourceTracks front to back. */
const withPosition = (positions: readonly number[], position: number, wanted: boolean) =>
  wanted
    ? [...positions.filter((each) => each !== position), position].sort((left, right) => left - right)
    : positions.filter((each) => each !== position);

/** Gives one SourceTrack its TrackRole. A SourceTrack has exactly one, so the other roles let go of it. */
export function setSourceTrackRole(session: CutSession, sourceTrackIndex: number, role: TrackRole): CutSession {
  // A position without a SourceTrack behind it would reach the decoder as an ffmpeg stream that does not exist.
  if (!session.recording) throw new Error("No Recording is chosen, so it has no SourceTracks to listen to.");
  const { sourceTracks } = session.recording;
  if (sourceTrackIndex < 0 || sourceTrackIndex >= sourceTracks.length) {
    throw new Error(
      `SourceTrack ${sourceTrackIndex + 1} does not exist: the Recording has ${sourceTracks.length}.`,
    );
  }
  return {
    ...session,
    listenTo: withPosition(session.listenTo, sourceTrackIndex, role === "voice"),
    contentSourceTracks: withPosition(session.contentSourceTracks, sourceTrackIndex, role === "content"),
  };
}

/** "Anfang festhalten": remembers where a LockedRange begins, until its Ende is marked. */
export function markLockedRangeStart(session: CutSession, atSeconds: number): CutSession {
  if (!session.recording) throw new Error("No Recording is chosen, so there is no moment to hold.");
  return { ...session, lockedRangeStart: atSeconds };
}

/**
 * "Ende festhalten": the stretch between the waiting Anfang and here is held. Which of the two lies earlier does not
 * matter — clicking back to where a moment began puts the Ende before the Anfang, and the same stretch is meant.
 */
export function markLockedRangeEnd(session: CutSession, atSeconds: number): CutSession {
  const anfang = session.lockedRangeStart;
  // A stretch from nowhere would hold everything before this moment, or nothing — neither is what was pressed.
  if (anfang === null) throw new Error("Press Anfang festhalten first: an Ende on its own holds nothing.");
  if (!session.recording) throw new Error("No Recording is chosen, so there is no moment to hold.");
  // Marks read off the audio clock can be microseconds apart without being equal. Less than a frame holds nothing
  // anyone could hear, yet the plan would widen it to a whole frame of the cut and the list would show "0:30,0 – 0:30,0".
  const { numerator, denominator } = session.recording.frameRate;
  if (Math.abs(atSeconds - anfang) < denominator / numerator) {
    throw new Error(`Anfang (${anfang} s) and Ende (${atSeconds} s) are less than a frame apart: that stretch has no length.`);
  }
  const marked = { startSeconds: anfang, endSeconds: atSeconds };
  return { ...session, lockedRanges: normalisedLockedRanges([...session.lockedRanges, marked]), lockedRangeStart: null };
}

/**
 * The held stretches as an optional field, named only when there are any. An absent list means none, as it does for
 * every request, setting and saved file written before held stretches existed.
 */
function heldIfAny(session: CutSession): { lockedRanges?: TimeRange[] } {
  return session.lockedRanges.length > 0 ? { lockedRanges: [...session.lockedRanges] } : {};
}

/** Whether two lists of held stretches hold exactly the same stretches. */
function sameRanges(was: readonly TimeRange[], is: readonly TimeRange[]): boolean {
  return (
    was.length === is.length &&
    was.every((range, at) => range.startSeconds === is[at]?.startSeconds && range.endSeconds === is[at]?.endSeconds)
  );
}

/** "entfernen": lets go of the held stretch at this place in the list, and of nothing else. */
export function removeLockedRange(session: CutSession, index: number): CutSession {
  // A button from before a redraw could otherwise remove whichever stretch sits at that place now, or nothing.
  if (!Number.isInteger(index) || index < 0 || index >= session.lockedRanges.length) {
    throw new Error(`There is no held stretch number ${index + 1}; there are ${session.lockedRanges.length}.`);
  }
  return { ...session, lockedRanges: session.lockedRanges.filter((_range, at) => at !== index) };
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

/** Kept before a ContentEvent, in place of the Margin. */
export function setEventLeadSeconds(session: CutSession, eventLeadSeconds: number): CutSession {
  return { ...session, eventLeadSeconds: clamp(eventLeadSeconds, EVENT_LEAD_SECONDS) };
}

/** Kept after a ContentEvent, in place of the Margin. */
export function setEventTailSeconds(session: CutSession, eventTailSeconds: number): CutSession {
  return { ...session, eventTailSeconds: clamp(eventTailSeconds, EVENT_TAIL_SECONDS) };
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
    ...heldIfAny(session),
    voiceSourceTracks: [...session.listenTo],
    contentSourceTracks: [...session.contentSourceTracks],
    decideBy: { kind: "loudness", thresholdDbfs: session.thresholdDbfs },
    marginSeconds: session.marginSeconds,
    eventLeadSeconds: session.eventLeadSeconds,
    eventTailSeconds: session.eventTailSeconds,
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

/** The settings as they are now, as the thing a finished plan belongs to. */
function settingsNow(session: CutSession): PlannedWith {
  return {
    lockedRanges: [...session.lockedRanges],
    listenTo: [...session.listenTo],
    contentSourceTracks: [...session.contentSourceTracks],
    thresholdDbfs: session.thresholdDbfs,
    marginSeconds: session.marginSeconds,
    eventLeadSeconds: session.eventLeadSeconds,
    eventTailSeconds: session.eventTailSeconds,
    minimumDeadZoneSeconds: session.minimumDeadZoneSeconds,
  };
}

/** After an analysis: the cut on screen matches the settings, and the audio it decoded is in memory. */
export function cutFinished(session: CutSession): CutSession {
  return { ...session, plannedWith: settingsNow(session), audioInMemory: true };
}

/**
 * After a replan or a new decision from the audio already in memory: the plan caught up with the settings. Neither
 * decodes anything, so whether the audio is in memory is left exactly as it was.
 */
export function planFinished(session: CutSession): CutSession {
  return { ...session, plannedWith: settingsNow(session) };
}

/**
 * Puts a saved session back on screen: the Recording it was cut from, what was ticked, the settings it was cut
 * with. The plan matches those settings, but nothing was decoded — so a new threshold means reading the Recording.
 */
export function projectOpened(session: CutSession, project: TrimProject): CutSession {
  const opened: CutSession = {
    ...session,
    recording: project.recording,
    scan: project.scan ?? null,
    emptySourceTracksShown: false,
    listenTo: [...project.listenTo],
    contentSourceTracks: [...(project.contentSourceTracks ?? [])],
    exportSourceTracks: [...project.exportSourceTracks],
    // The window only offers the loudness decision (ADR-0003); a project saved with the voice decision keeps the
    // threshold slider where it was.
    thresholdDbfs:
      project.decideBy.kind === "loudness" ? project.decideBy.thresholdDbfs : session.thresholdDbfs,
    marginSeconds: project.marginSeconds,
    eventLeadSeconds: project.eventLeadSeconds ?? session.eventLeadSeconds,
    eventTailSeconds: project.eventTailSeconds ?? session.eventTailSeconds,
    minimumDeadZoneSeconds: project.minimumDeadZoneSeconds,
    plannedWith: null,
    audioInMemory: false,
    // Exactly the project's own held stretches: none from a file older than them, and none from the session before.
    lockedRanges: normalisedLockedRanges(project.lockedRanges ?? []),
    lockedRangeStart: null,
  };
  return { ...opened, plannedWith: settingsNow(opened) };
}

/** The settings a replan needs; the rest of a request decides what was found, not how it is planned. */
export function planSettingsFrom(session: CutSession): PlanSettings {
  return {
    ...heldIfAny(session),
    marginSeconds: session.marginSeconds,
    eventLeadSeconds: session.eventLeadSeconds,
    eventTailSeconds: session.eventTailSeconds,
    minimumDeadZoneSeconds: session.minimumDeadZoneSeconds,
  };
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
  const same = (was: readonly number[], is: readonly number[]) =>
    was.length === is.length && was.every((position, index) => position === is[index]);
  // Another SourceTrack is audio nobody has decoded yet, whichever role it was given.
  if (!same(planned.listenTo, session.listenTo)) return "analyse";
  if (!same(planned.contentSourceTracks, session.contentSourceTracks)) return "analyse";
  // Deciding again plans as well, so a threshold that moved together with a Margin is still one job — but only
  // while the audio it would be decided from is still in memory.
  if (planned.thresholdDbfs !== session.thresholdDbfs) return session.audioInMemory ? "redecide" : "analyse";
  if (
    planned.marginSeconds !== session.marginSeconds ||
    planned.eventLeadSeconds !== session.eventLeadSeconds ||
    planned.eventTailSeconds !== session.eventTailSeconds ||
    planned.minimumDeadZoneSeconds !== session.minimumDeadZoneSeconds ||
    // Held stretches are planned around what was found, like a Margin: holding or letting one go reads nothing.
    !sameRanges(planned.lockedRanges, session.lockedRanges)
  ) {
    return "replan";
  }
  return "nothing";
}

/** Puts a Preset's thresholds on the sliders. What each SourceTrack contributes is left as it is. */
export function applyPreset(session: CutSession, preset: Preset): CutSession {
  return {
    ...session,
    selectedPreset: preset.name,
    thresholdDbfs: preset.thresholdDbfs,
    marginSeconds: preset.marginSeconds,
    eventLeadSeconds: preset.eventLeadSeconds,
    eventTailSeconds: preset.eventTailSeconds,
    minimumDeadZoneSeconds: preset.minimumDeadZoneSeconds,
  };
}

/**
 * Says that what a new threshold is decided from is back in memory — the chunk levels (ADR-0021) — after a
 * reopened project's SourceTracks were read again (ADR-0020). It says nothing about the sliders: a slider moved
 * while that read was running still needs the plan
 * redone, which `cutFinished` would have swallowed by marking those settings as the ones the cut was made with.
 */
export function audioBackInMemory(session: CutSession): CutSession {
  return { ...session, audioInMemory: true };
}

/**
 * The SourceTracks whose audio still has to be read, so their waveform can be shown. Every SourceTrack with a
 * role — Voice or Content — needs one, and the read is the same one the cut needs later, only earlier (ADR-0020).
 */
export function sourceTracksToRead(session: CutSession, alreadyRead: readonly number[]): readonly number[] {
  return [...session.listenTo, ...session.contentSourceTracks]
    .filter((position) => !alreadyRead.includes(position))
    .sort((one, other) => one - other);
}

/** What the window says about the chosen Preset: its name, and whether the sliders have been moved off it. */
export interface PresetChoice {
  name: string;
  /** True once a slider no longer matches the Preset, which the window shows as "(geändert)". */
  changed: boolean;
}

/**
 * The Preset the user picked and what has become of it, or null when none is picked — after the chosen one was
 * deleted, say. The choice is remembered, not deduced: moving a slider marks it changed rather than clearing it,
 * so the window can still offer to overwrite or delete it (ADR-0018).
 */
export function presetChoice(session: CutSession, own: readonly Preset[]): PresetChoice | null {
  const { selectedPreset } = session;
  if (selectedPreset === null) return null;
  const preset = [...PRESETS, ...own].find((each) => each.name === selectedPreset);
  // A Preset that is gone — deleted, or in a preset file that would not read — leaves nothing chosen.
  if (!preset) return null;
  return { name: preset.name, changed: !matchesSliders(preset, session) };
}

/** Whether every one of a Preset's five settings is still what the sliders say. */
function matchesSliders(preset: Preset, session: CutSession): boolean {
  return (
    preset.thresholdDbfs === session.thresholdDbfs &&
    preset.marginSeconds === session.marginSeconds &&
    preset.eventLeadSeconds === session.eventLeadSeconds &&
    preset.eventTailSeconds === session.eventTailSeconds &&
    preset.minimumDeadZoneSeconds === session.minimumDeadZoneSeconds
  );
}

/** What a saved project records about the session: the choices behind the cut, and the export ticks. */
export function savedChoicesFrom(session: CutSession): SavedChoices {
  const choices: SavedChoices = {
    voiceSourceTracks: [...session.listenTo],
    contentSourceTracks: [...session.contentSourceTracks],
    exportSourceTracks: [...session.exportSourceTracks],
    decideBy: { kind: "loudness", thresholdDbfs: session.thresholdDbfs },
    marginSeconds: session.marginSeconds,
    eventLeadSeconds: session.eventLeadSeconds,
    eventTailSeconds: session.eventTailSeconds,
    minimumDeadZoneSeconds: session.minimumDeadZoneSeconds,
    // The user's own work on this Recording; a reopened project without it would cut away what they held.
    ...heldIfAny(session),
  };
  return session.scan ? { ...choices, scan: session.scan } : choices;
}
