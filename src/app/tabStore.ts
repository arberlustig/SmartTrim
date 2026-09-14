import {
  readSourceTrackFrom,
  type AnalysisRequest,
  type AnalysisTools,
  type ReadSourceTrack,
} from "../analysis/analyseRecording.ts";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { decodeSourceTracks } from "../decode/decodeSourceTracks.ts";
import { saveTrimProject, trimProjectOf, type SavedChoices } from "../project/openTrimProject.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import { readExcerpt, type Excerpt } from "../playback/readExcerpt.ts";
import { scanSourceTracks, type SourceTrackScan } from "../scan/scanSourceTracks.ts";
import { recordingPathOf, sameRecording, type OpenedFile } from "./openFile.ts";
import {
  redecideCut,
  replanCut,
  runCut,
  saveCutPlan,
  waveformOf,
  type CutResult,
  type CutSummary,
  type PlanSettings,
  type SourceTrackWaveform,
} from "./runCut.ts";

/** What opening a file did: gave it a Tab of its own, or found the Tab its Recording already has. */
export interface OpenedTab {
  tabId: number;
  alreadyOpen: boolean;
}

/** Called as each SourceTrack of a read finishes. */
export type OnRead = (done: number, total: number) => void;

/** Everything the main process keeps for one Tab (CONTEXT.md). Nothing in here is shared with another Tab. */
interface Tab {
  recording: RecordingInfo;
  /** The cut that waits to be saved, so the CutPlan never crosses into the window (ADR-0012). */
  lastCut: CutResult | null;
  /**
   * What was read of each SourceTrack, by position: its chunk levels and its waveform, never its audio (ADR-0021).
   * The cut reuses it rather than reading the Recording a second time (ADR-0020).
   */
  read: Map<number, ReadSourceTrack>;
  /**
   * Which SourceTracks a reopened project was cut from, so its audio can be read again for the waveform. A project
   * holds what the analysis found, never the audio itself (ADR-0016), so this is the only record of them.
   */
  reopenedVoice: readonly number[];
  reopenedSourceTracks: readonly number[];
  /** Where this Tab's project lives: the file it was opened from, or the one it was last saved to. */
  projectPath: string | null;
}

/**
 * A path beside `recordingPath` with the Recording's name and `extension` that holds no file yet: `Part1.smarttrim`,
 * else `Part1 (2).smarttrim`, and so on. Whatever lies there already — an older project nobody opened — is never
 * written over.
 */
export async function freePathBeside(recordingPath: string, extension: string): Promise<string> {
  const stem = join(dirname(recordingPath), basename(recordingPath, extname(recordingPath)));
  for (let number = 1; ; number += 1) {
    const candidate = number === 1 ? `${stem}${extension}` : `${stem} (${number})${extension}`;
    if (!(await stat(candidate).catch(() => null))) return candidate;
  }
}

/**
 * The Tabs the window has open, as the main process holds them: for each one its Recording, what was read of it and
 * the cut that waits to be saved. Every request names its Tab, so one Recording can never be cut from another's
 * levels, and whatever arrives for a Tab closed in the meantime is refused rather than filed (ADR-0025).
 */
export interface TabStore {
  /**
   * Gives an opened file a Tab — or, when its Recording is already open, answers with that Tab and changes nothing. A
   * project's `path` is where the Tab saves back to.
   */
  open(file: OpenedFile & { path?: string }): OpenedTab;
  /**
   * Writes the Tab's project without asking where: back into the file it came from or was last saved to, else beside
   * its Recording under a name no file has yet. Returns where it landed.
   */
  saveProject(tabId: number, choices: SavedChoices): Promise<string>;
  /**
   * What "Alle Premiere-Dateien speichern" writes for a Tab, asking nothing (ADR-0026): its Premiere file beside its
   * Recording, with TimelineTracks for `exportSourceTracks`, under a name no file has yet — SmartTrim never opens one
   * again, so none is ever written over. Returns where it landed.
   */
  savePremiereBeside(tabId: number, exportSourceTracks: readonly number[]): Promise<string>;
  /** Lets go of everything the Tab held. A job still running for it is refused when it finishes. */
  close(tabId: number): void;
  /** The Tab's Recording as probed. */
  recordingOf(tabId: number): RecordingInfo;
  /** The Tab's finished cut, for saving. Refused while there is none. */
  cutOf(tabId: number): CutResult;
  /** Listens to a few slices of every SourceTrack of the Tab's Recording, to find the ones carrying nothing. */
  scan(tabId: number): Promise<SourceTrackScan[]>;
  /**
   * Reads the named SourceTracks of the Tab's Recording, so their waveform can be drawn before anything is cut
   * (ADR-0020). What is read stays with the Tab: its cut reuses it, and a role taken away and put back costs nothing.
   */
  readSourceTracks(tabId: number, positions: readonly number[], onRead?: OnRead): Promise<SourceTrackWaveform[]>;
  /** Reads one SourceTrack of the Tab's Recording over a stretch, for the window to play; nothing of it is kept (ADR-0022). */
  readExcerpt(tabId: number, request: { position: number; fromSeconds: number; toSeconds: number }): Promise<Excerpt>;
  /** Analyses the Tab's Recording and plans the cuts. The plan stays here until it is saved. */
  cut(tabId: number, request: AnalysisRequest): Promise<CutSummary>;
  /** The waveform of every SourceTrack the Tab's last analysis read. */
  waveformsOfCut(tabId: number): SourceTrackWaveform[];
  /** Plans the Tab's cuts again from what its analysis found, without reading the Recording (ADR-0004). */
  replan(tabId: number, settings: PlanSettings): CutSummary;
  /** Decides the Tab's cut again at another threshold, from the chunk levels in memory (ADR-0004). */
  redecide(tabId: number, settings: PlanSettings & { thresholdDbfs: number }): CutSummary;
  /**
   * Reads the audio of a reopened project again, so its waveform appears and a threshold can be tried again without
   * pressing Schneiden. The plan is not touched: it was recomputed on opening.
   */
  readProjectAudio(tabId: number, onRead?: OnRead): Promise<SourceTrackWaveform[]>;
}

export function newTabStore(tools: () => Promise<AnalysisTools>): TabStore {
  const tabs = new Map<number, Tab>();
  let lastId = 0;

  function tabOf(tabId: number): Tab {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} is closed.`);
    return tab;
  }

  /**
   * Refuses what a job brought in for a Tab closed while it ran. Checked after every wait: the ffmpeg of a closed Tab
   * keeps running to its end, and what it read belongs to nothing on screen.
   */
  function stillOpen(tabId: number, tab: Tab): void {
    if (tabs.get(tabId) !== tab) throw new Error(`Tab ${tabId} is closed.`);
  }

  /** Writes the Tab's cut and `choices` as a project at `path`, and saves there from now on. */
  async function saveProjectAs(tabId: number, choices: SavedChoices, path: string): Promise<string> {
    const tab = tabOf(tabId);
    await saveTrimProject(path, trimProjectOf(cutOf(tabId), choices));
    tab.projectPath = path;
    return path;
  }

  function cutOf(tabId: number): CutResult {
    const { lastCut } = tabOf(tabId);
    if (!lastCut) throw new Error("There is no finished cut in this Tab. Cut it first.");
    return lastCut;
  }

  return {
    open(file) {
      const path = recordingPathOf(file);
      for (const [tabId, tab] of tabs) {
        if (sameRecording(tab.recording.path, path)) return { tabId, alreadyOpen: true };
      }
      lastId += 1;
      if (file.kind === "recording") {
        tabs.set(lastId, {
          recording: file.recording,
          lastCut: null,
          read: new Map(),
          reopenedVoice: [],
          reopenedSourceTracks: [],
          projectPath: null,
        });
      } else {
        const voice = file.project.listenTo;
        tabs.set(lastId, {
          recording: file.cut.recording,
          lastCut: file.cut,
          read: new Map(),
          reopenedVoice: voice,
          reopenedSourceTracks: [...new Set([...voice, ...(file.project.contentSourceTracks ?? [])])],
          projectPath: file.path ?? null,
        });
      }
      return { tabId: lastId, alreadyOpen: false };
    },

    async saveProject(tabId, choices) {
      const tab = tabOf(tabId);
      return saveProjectAs(tabId, choices, tab.projectPath ?? (await freePathBeside(tab.recording.path, ".smarttrim")));
    },

    async savePremiereBeside(tabId, exportSourceTracks) {
      const { recording, cutPlan } = cutOf(tabId);
      const premierePath = await freePathBeside(recording.path, ".xml");
      await saveCutPlan(premierePath, recording, cutPlan, exportSourceTracks);
      return premierePath;
    },

    close(tabId) {
      tabs.delete(tabId);
    },

    recordingOf(tabId) {
      return tabOf(tabId).recording;
    },

    cutOf,

    async scan(tabId) {
      const tab = tabOf(tabId);
      const scan = await scanSourceTracks(tab.recording, (await tools()).ffmpeg);
      stillOpen(tabId, tab);
      return scan;
    },

    async readSourceTracks(tabId, positions, onRead) {
      const tab = tabOf(tabId);
      const missing = positions.filter((position) => !tab.read.has(position));
      if (missing.length > 0) {
        // Each SourceTrack is read down to its levels and waveform as soon as it is decoded, and its audio let go.
        const read = await decodeSourceTracks(tab.recording, missing, (await tools()).ffmpeg, readSourceTrackFrom, onRead);
        stillOpen(tabId, tab);
        for (const one of read) tab.read.set(one.position, one);
      }
      return positions.map((position) => waveformOf(tab.read.get(position) as ReadSourceTrack));
    },

    async readExcerpt(tabId, { position, fromSeconds, toSeconds }) {
      const tab = tabOf(tabId);
      const excerpt = await readExcerpt(tab.recording, position, fromSeconds, toSeconds, (await tools()).ffmpeg);
      stillOpen(tabId, tab);
      return excerpt;
    },

    async cut(tabId, request) {
      const tab = tabOf(tabId);
      // What was read is matched to a request by position alone, so a request naming another file would be cut from
      // this Recording's levels. The window never asks that; if it ever does, it is a fault to show, not to guess at.
      if (!sameRecording(tab.recording.path, request.recordingPath)) {
        throw new Error(`Tab ${tabId} holds ${tab.recording.path}, not ${request.recordingPath}.`);
      }
      tab.lastCut = null;
      // Whatever the waveforms already read is handed over, so the Recording is read once and not twice.
      const result = await runCut(request, await tools(), [...tab.read.values()]);
      stillOpen(tabId, tab);
      tab.lastCut = result;
      // An analysis may have read more SourceTracks than the waveforms did; keep those too.
      for (const read of result.read) if (!tab.read.has(read.position)) tab.read.set(read.position, read);
      return result.summary;
    },

    waveformsOfCut(tabId) {
      return cutOf(tabId).read.map(waveformOf);
    },

    replan(tabId, settings) {
      const tab = tabOf(tabId);
      tab.lastCut = replanCut(cutOf(tabId), settings);
      return tab.lastCut.summary;
    },

    redecide(tabId, settings) {
      const tab = tabOf(tabId);
      tab.lastCut = redecideCut(cutOf(tabId), settings.thresholdDbfs, settings);
      return tab.lastCut.summary;
    },

    async readProjectAudio(tabId, onRead) {
      const tab = tabOf(tabId);
      const readingFor = cutOf(tabId);
      if (readingFor.read.length > 0) return readingFor.read.map(waveformOf);
      const positions = tab.reopenedSourceTracks;
      if (positions.length === 0) throw new Error("This project names no SourceTrack to listen to.");

      const read = await decodeSourceTracks(tab.recording, positions, (await tools()).ffmpeg, readSourceTrackFrom, onRead);
      stillOpen(tabId, tab);
      // The Voice SourceTracks are what another threshold is decided from, in the order the project names them. A
      // replan while this ran left the project's findings in place and still lacks them; a cut made meanwhile read its
      // own and is left alone.
      if (tab.lastCut && tab.lastCut.listened.length === 0) {
        const listened = tab.reopenedVoice.map((position) => read[positions.indexOf(position)] as ReadSourceTrack);
        tab.lastCut = { ...tab.lastCut, read, listened };
      }
      // Into the same store the cut reads from, or pressing Schneiden would read the whole Recording again and break
      // ADR-0004's promise that it is read once.
      for (const one of read) tab.read.set(one.position, one);
      return read.map(waveformOf);
    },
  };
}
