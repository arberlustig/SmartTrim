import type { AnalysisRequest } from "../analysis/analyseRecording.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";

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
  /** The SourceTracks the user ticked, by position in the Recording, 0 being the first. */
  listenTo: readonly number[];
  thresholdDbfs: number;
  marginSeconds: number;
  minimumDeadZoneSeconds: number;
}

/** A session on the settings the owner chose after listening to the alternatives (ADR-0003). */
export function newCutSession(): CutSession {
  return {
    recording: null,
    listenTo: [],
    thresholdDbfs: -40,
    marginSeconds: 0.05,
    minimumDeadZoneSeconds: 0.25,
  };
}

/** Chooses a probed Recording. Ticks from the previous Recording are dropped: its SourceTracks are gone with it. */
export function chooseRecording(session: CutSession, recording: RecordingInfo): CutSession {
  return { ...session, recording, listenTo: [] };
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
