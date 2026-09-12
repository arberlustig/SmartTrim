import type { AnalysisRequest } from "../analysis/analyseRecording.ts";
import type { Preset } from "../app/cutSession.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import type { CutSummary, PlanSettings, SourceTrackWaveform } from "../app/runCut.ts";
import type { SavedChoices } from "../project/openTrimProject.ts";
import type { TrimProject } from "../project/trimProject.ts";
import type { SourceTrackScan } from "../scan/scanSourceTracks.ts";

/**
 * Every answer the window gets from the main process, so a refusal reaches the user as a sentence instead of as an
 * IPC exception. `null` means the user closed the dialog.
 */
export type Answer<Value> = { ok: true; value: Value } | { ok: false; message: string };

/** How far reading the SourceTracks of a Recording has got. */
export interface ReadProgress {
  done: number;
  total: number;
}

/** How far the first-run download has got. */
export interface ToolsProgress {
  name: string;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

/** What the window can ask the main process to do. Nothing else crosses into Node. */
export interface SmartTrimApi {
  /** Finds ffmpeg and the Silero model, downloading them on a first run. Everything else waits for this. */
  ensureTools(): Promise<Answer<null>>;
  /** Called while the first-run download runs. */
  onToolsProgress(listen: (progress: ToolsProgress) => void): void;
  /** Opens the file dialog and probes what the user picked. */
  chooseRecording(): Promise<Answer<RecordingInfo | null>>;
  /** Listens to a few slices of every SourceTrack of the chosen Recording, to find the ones carrying nothing. */
  scan(): Promise<Answer<SourceTrackScan[]>>;
  /**
   * Reads the named SourceTracks so their waveform can be shown before anything is cut. What is read is kept
   * for the rest of the Recording, so the cut below does not read it a second time (ADR-0020).
   */
  readSourceTracks(positions: readonly number[]): Promise<Answer<SourceTrackWaveform[]>>;
  /** Called as each SourceTrack finishes being read, so the window can say how far it has got. */
  onReadProgress(listen: (progress: ReadProgress) => void): void;
  /** Analyses the Recording and plans the cuts. The plan stays in the main process until it is saved. */
  cut(request: AnalysisRequest): Promise<Answer<CutSummary>>;
  /**
   * The waveform of every SourceTrack the last analysis read, for the window to draw. Asked for once per
   * analysis: moving a slider changes the colours over the waveform, never its shape.
   */
  waveforms(): Promise<Answer<SourceTrackWaveform[]>>;
  /** Plans the cuts again from what the last analysis found, without reading the Recording again. */
  replan(settings: PlanSettings): Promise<Answer<CutSummary>>;
  /** Decides again at another loudness threshold, from the audio the last analysis left in memory. */
  redecide(settings: PlanSettings & { thresholdDbfs: number }): Promise<Answer<CutSummary>>;
  /**
   * Opens the save dialog and writes the Premiere file, with TimelineTracks for the named SourceTracks only.
   * Returns where it landed.
   */
  save(exportSourceTracks: readonly number[]): Promise<Answer<string | null>>;
  /** Opens the save dialog and writes the session as a `.smarttrim` project. Returns where it landed. */
  saveProject(choices: SavedChoices): Promise<Answer<string | null>>;
  /**
   * Reads the audio of a reopened project in the background, so its waveform appears and a threshold can be
   * tried again. A project holds what the analysis found, never the audio (ADR-0016).
   */
  readProjectAudio(): Promise<Answer<SourceTrackWaveform[]>>;
  /** Opens a `.smarttrim` project, checking that the Recording it names is still the one it was cut from. */
  openProject(): Promise<Answer<{ project: TrimProject; summary: CutSummary } | null>>;
  /** The Presets the user saved themselves, read from their folder. Built-in Presets are not in here. */
  loadPresets(): Promise<Answer<readonly Preset[]>>;
  /** Saves a Preset under its name, replacing one of that name. Returns the user's own Presets as they now are. */
  savePreset(preset: Preset): Promise<Answer<readonly Preset[]>>;
  /** Deletes one of the user's own Presets by name. Returns the ones left. */
  deletePreset(name: string): Promise<Answer<readonly Preset[]>>;
  /** Shows a saved file in Explorer. */
  reveal(path: string): Promise<Answer<null>>;
}
