import { writeFile } from "node:fs/promises";
import {
  analyseRecording,
  type AnalysisRequest,
  type AnalysisTools,
  type DecodedSourceTrack,
} from "../analysis/analyseRecording.ts";
import { planCuts, type CutPlan, type TimeRange } from "../cutting/planCuts.ts";
import { exportFcp7Xml, type RecordingInfo } from "../export/exportFcp7Xml.ts";
import { detectLoudness } from "../level/detectLoudness.ts";
import type { MonoPcm } from "../speech/detectSpeech.ts";
import { peakEnvelope } from "../waveform/peakEnvelope.ts";

/** What the window reports once a CutPlan exists. Seconds, because that is what the user recognises. */
export interface CutSummary {
  recordingSeconds: number;
  keptSeconds: number;
  removedSeconds: number;
  /** Removed share of the Recording, 0 to 1. */
  removedShare: number;
  keepSegments: number;
  /**
   * The stretches of the Recording the plan keeps, in seconds. The CutPlan itself still stays in the main process
   * (ADR-0012); this is what the window needs to colour the strip and the waveforms, and it changes with every
   * slider, so it travels with the summary (ADR-0019).
   */
  keptRanges: readonly TimeRange[];
}

/** Rounds to milliseconds, so a frame count that divides badly does not report 133.59999999999998 seconds. */
function toSeconds(frames: number, { numerator, denominator }: RecordingInfo["frameRate"]): number {
  return Number(((frames * denominator) / numerator).toFixed(3));
}

/** Measures a CutPlan against the Recording it was planned from: what survives and what SmartTrim removes. */
export function summariseCutPlan(recording: RecordingInfo, cutPlan: CutPlan): CutSummary {
  const keptFrames = cutPlan.reduce((total, segment) => total + (segment.recordingOut - segment.recordingIn), 0);
  const removedFrames = recording.durationFrames - keptFrames;
  return {
    recordingSeconds: toSeconds(recording.durationFrames, recording.frameRate),
    keptSeconds: toSeconds(keptFrames, recording.frameRate),
    removedSeconds: toSeconds(removedFrames, recording.frameRate),
    removedShare: recording.durationFrames === 0 ? 0 : Number((removedFrames / recording.durationFrames).toFixed(4)),
    keepSegments: cutPlan.length,
    keptRanges: cutPlan.map((segment) => ({
      startSeconds: toSeconds(segment.recordingIn, recording.frameRate),
      endSeconds: toSeconds(segment.recordingOut, recording.frameRate),
    })),
  };
}

/** A finished cut, before it is saved: the Recording as probed, the plan, and what to tell the user about it. */
export interface CutResult {
  recording: RecordingInfo;
  /**
   * The decoded SourceTracks that were listened to, kept in memory for the rest of the session, so another
   * threshold can be decided without touching the Recording again (ADR-0004). Never sent to the window.
   */
  listened: readonly MonoPcm[];
  /**
   * Every SourceTrack that was decoded, by its position in the Recording — the ones the window draws a waveform
   * for. Never sent over IPC either; `waveformsOf` turns it into something small enough to send (ADR-0019).
   */
  decoded: readonly DecodedSourceTrack[];
  /**
   * The stretches the analysis found worth keeping, before any Margin or MinimumDeadZone was applied. Kept so that
   * those two settings can be changed without reading the Recording again (ADR-0004).
   */
  worthKeeping: readonly TimeRange[];
  /** The moments found on the Content SourceTracks, kept so a replan keeps them too. */
  contentEvents: readonly TimeRange[];
  cutPlan: CutPlan;
  summary: CutSummary;
}

/** The settings that only decide how the cuts are planned, not what counts as worth keeping. */
export interface PlanSettings {
  marginSeconds: number;
  /** Kept before a ContentEvent, in place of the Margin. */
  eventLeadSeconds?: number;
  /** Kept after a ContentEvent, in place of the Margin. */
  eventTailSeconds?: number;
  /** ADR-0007: measured after the Margin is kept. */
  minimumDeadZoneSeconds: number;
}

/**
 * Decides again, at another loudness threshold, from the audio already in memory, and plans the cuts around it.
 * Only the loudness decision can be repeated this way; the voice decision would need the Silero model again, and the
 * window does not offer it (ADR-0003).
 */
export function redecideCut(cut: CutResult, thresholdDbfs: number, settings: PlanSettings): CutResult {
  if (cut.listened.length === 0) {
    throw new Error("The audio of this cut is no longer in memory, so it has to be read again.");
  }
  const worthKeeping = cut.listened.flatMap((pcm) => detectLoudness(pcm, thresholdDbfs));
  return replanCut({ ...cut, worthKeeping }, settings);
}

/**
 * Plans the cuts again from what the analysis already found, without touching the Recording. What comes out is the
 * same plan reading the Recording again would produce — the test compares the two on a real file.
 */
export function replanCut(cut: CutResult, settings: PlanSettings): CutResult {
  const cutPlan = planCuts({
    recording: cut.recording,
    speech: cut.worthKeeping,
    contentEvents: cut.contentEvents,
    // LockedRanges do not exist yet.
    lockedRanges: [],
    marginSeconds: settings.marginSeconds,
    eventLeadSeconds: settings.eventLeadSeconds ?? 0,
    eventTailSeconds: settings.eventTailSeconds ?? 0,
    minimumDeadZoneSeconds: settings.minimumDeadZoneSeconds,
  });
  return { ...cut, cutPlan, summary: summariseCutPlan(cut.recording, cutPlan) };
}

/**
 * The whole job behind the Schneiden button: analyse the Recording and measure the plan it produced. The Recording
 * is only read (ADR-0006), and nothing is written until the user picks a place to save.
 */
export async function runCut(request: AnalysisRequest, tools: AnalysisTools): Promise<CutResult> {
  const { recording, listened, decoded, worthKeeping, contentEvents, cutPlan } = await analyseRecording(request, tools);
  return {
    recording,
    listened,
    decoded,
    worthKeeping,
    contentEvents,
    cutPlan,
    summary: summariseCutPlan(recording, cutPlan),
  };
}

/** One SourceTrack's waveform as the window draws it: a height per slice of time, 0 to 1. */
export interface SourceTrackWaveform {
  /** Position in the Recording, 0 being the first — the number the window puts on the row. */
  position: number;
  peaksPerSecond: number;
  peaks: Float32Array;
}

/**
 * How finely the waveform is drawn. Twenty a second is a peak every 50 ms: at the closest zoom that is two peaks
 * per pixel, and over a 2.5-hour Recording it is 182 000 numbers — 728 KB, sent once per analysis (ADR-0019).
 */
export const PEAKS_PER_SECOND = 20;

/**
 * The waveforms for every SourceTrack the analysis decoded. Computed on demand rather than kept in the CutResult:
 * a replan changes the colours, never the shape of the sound, so the window asks for these once.
 */
export function waveformsOf(cut: CutResult): SourceTrackWaveform[] {
  return cut.decoded.map(({ position, pcm }) => ({
    position,
    peaksPerSecond: PEAKS_PER_SECOND,
    peaks: peakEnvelope(pcm, PEAKS_PER_SECOND),
  }));
}

/**
 * Writes the CutPlan where the user chose, as the FCP7 XML Premiere imports (ADR-0002).
 * `exportSourceTracks` names the SourceTracks the sequence gets TimelineTracks for; by default every one of them.
 */
export async function saveCutPlan(
  destinationPath: string,
  recording: RecordingInfo,
  cutPlan: CutPlan,
  exportSourceTracks?: readonly number[],
): Promise<void> {
  // The whole file is rendered before the write starts, so a refused destination leaves nothing behind at all.
  const xml = exportFcp7Xml(recording, cutPlan, exportSourceTracks);
  try {
    await writeFile(destinationPath, xml, "utf8");
  } catch (error) {
    // Node's own message is "ENOENT: no such file or directory, open ..."; the window shows this one to the user.
    const reason = (error as { code?: string }).code ?? (error as Error).message;
    throw new Error(`Could not write the Premiere file to ${destinationPath} (${reason}).`, { cause: error });
  }
}
