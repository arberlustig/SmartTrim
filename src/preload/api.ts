import type { AnalysisRequest } from "../analysis/analyseRecording.ts";
import type { Preset } from "../app/cutSession.ts";
import type { Refusal } from "../app/openFile.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import type { Excerpt } from "../playback/readExcerpt.ts";
import type { CutSummary, PlanSettings, SourceTrackWaveform } from "../app/runCut.ts";
import type { SavedChoices } from "../project/openTrimProject.ts";
import type { TrimProject } from "../project/trimProject.ts";
import type { SourceTrackScan } from "../scan/scanSourceTracks.ts";

/**
 * Every answer the window gets from the main process, so a refusal reaches the user as a sentence instead of as an
 * IPC exception. `null` means the user closed the dialog.
 */
export type Answer<Value> = { ok: true; value: Value } | { ok: false; message: string };

/**
 * One file the window was handed, once opened: a new Tab with the Recording or the project it holds — a project with
 * its CutSummary, its CutPlan staying in the main process like every other (ADR-0012) — or the Tab its Recording
 * already has, which the window shows instead of opening a second one (ADR-0025).
 */
export type OpenedTab =
  | { tabId: number; path: string; alreadyOpen: false; kind: "recording"; recording: RecordingInfo }
  | { tabId: number; path: string; alreadyOpen: false; kind: "project"; project: TrimProject; summary: CutSummary }
  | { tabId: number; path: string; alreadyOpen: true; kind: "recording" | "project" };

/**
 * What opening one or several files did: the Tabs they are in, and the files that would not open — each with the kind
 * of refusal, which the window words, and the core of what was reported.
 */
export interface OpenedInWindow {
  tabs: readonly OpenedTab[];
  refused: readonly Refusal[];
}

/** Which SourceTrack of a Tab to play, and over which stretch of its Recording (ADR-0022). */
export interface ExcerptRequest {
  tabId: number;
  position: number;
  fromSeconds: number;
  toSeconds: number;
}

/** How far reading the SourceTracks of a Tab's Recording has got. */
export interface ReadProgress {
  tabId: number;
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

/**
 * What the window can ask the main process to do. Nothing else crosses into Node. Everything about one Recording
 * names the Tab it belongs to: positions repeat from Recording to Recording, so a request without its Tab could be
 * answered from the wrong one (ADR-0025).
 */
export interface SmartTrimApi {
  /** Finds ffmpeg and the Silero model, downloading them on a first run. Everything else waits for this. */
  ensureTools(): Promise<Answer<null>>;
  /** Called while the first-run download runs. */
  onToolsProgress(listen: (progress: ToolsProgress) => void): void;
  /** Opens the file dialog and opens every file the user picked, each in a Tab: Recordings, or projects. */
  chooseRecording(): Promise<Answer<OpenedInWindow | null>>;
  /** Where a file dropped on the window lives on disk; empty for something dropped that is no file on disk. */
  pathOf(file: File): string;
  /** Opens files and folders by their paths, each file in a Tab; a folder opens the files directly inside it. */
  openFiles(paths: readonly string[]): Promise<Answer<OpenedInWindow>>;
  /** Lets go of everything the main process holds for a Tab. */
  closeTab(tabId: number): Promise<Answer<null>>;
  /** Listens to a few slices of every SourceTrack of a Tab's Recording, to find the ones carrying nothing. */
  scan(tabId: number): Promise<Answer<SourceTrackScan[]>>;
  /**
   * Reads the named SourceTracks of a Tab's Recording so their waveform can be shown before anything is cut. What is
   * read is kept with the Tab, so its cut does not read it a second time (ADR-0020).
   */
  readSourceTracks(tabId: number, positions: readonly number[]): Promise<Answer<SourceTrackWaveform[]>>;
  /**
   * Reads one SourceTrack of a Tab's Recording over a stretch of at most three minutes, both Channels at its own
   * sample rate, for the window to play. Nothing of it is kept (ADR-0022).
   */
  readExcerpt(request: ExcerptRequest): Promise<Answer<Excerpt>>;
  /** Called as each SourceTrack finishes being read, so the window can say how far it has got. */
  onReadProgress(listen: (progress: ReadProgress) => void): void;
  /** Analyses a Tab's Recording and plans the cuts. The plan stays in the main process until it is saved. */
  cut(tabId: number, request: AnalysisRequest): Promise<Answer<CutSummary>>;
  /**
   * The waveform of every SourceTrack a Tab's last analysis read, for the window to draw. Asked for once per
   * analysis: moving a slider changes the colours over the waveform, never its shape.
   */
  waveforms(tabId: number): Promise<Answer<SourceTrackWaveform[]>>;
  /** Plans a Tab's cuts again from what its last analysis found, without reading the Recording again. */
  replan(tabId: number, settings: PlanSettings): Promise<Answer<CutSummary>>;
  /** Decides a Tab's cut again at another loudness threshold, from the chunk levels in memory. */
  redecide(tabId: number, settings: PlanSettings & { thresholdDbfs: number }): Promise<Answer<CutSummary>>;
  /**
   * Opens the save dialog and writes a Tab's Premiere file, with TimelineTracks for the named SourceTracks only.
   * Returns where it landed.
   */
  save(tabId: number, exportSourceTracks: readonly number[]): Promise<Answer<string | null>>;
  /**
   * Writes a Tab as a `.smarttrim` project without asking where: into the project it came from or was last saved to,
   * else beside its Recording, never over another file. Returns where it landed.
   */
  saveProjectBeside(tabId: number, choices: SavedChoices): Promise<Answer<string>>;
  /**
   * Reads the audio of a Tab's reopened project in the background, so its waveform appears and a threshold can be
   * tried again. A project holds what the analysis found, never the audio (ADR-0016).
   */
  readProjectAudio(tabId: number): Promise<Answer<SourceTrackWaveform[]>>;
  /** Opens the project dialog and opens every project picked, each in a Tab. */
  openProject(): Promise<Answer<OpenedInWindow | null>>;
  /** The Presets the user saved themselves, read from their folder. Built-in Presets are not in here. */
  loadPresets(): Promise<Answer<readonly Preset[]>>;
  /** Saves a Preset under its name, replacing one of that name. Returns the user's own Presets as they now are. */
  savePreset(preset: Preset): Promise<Answer<readonly Preset[]>>;
  /** Deletes one of the user's own Presets by name. Returns the ones left. */
  deletePreset(name: string): Promise<Answer<readonly Preset[]>>;
  /** Shows a saved file in Explorer. */
  reveal(path: string): Promise<Answer<null>>;
}
