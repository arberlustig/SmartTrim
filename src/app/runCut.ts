import { writeFile } from "node:fs/promises";
import { analyseRecording, type AnalysisRequest, type AnalysisTools } from "../analysis/analyseRecording.ts";
import { planCuts, type CutPlan, type TimeRange } from "../cutting/planCuts.ts";
import { exportFcp7Xml, type RecordingInfo } from "../export/exportFcp7Xml.ts";
import { detectLoudness } from "../level/detectLoudness.ts";
import type { MonoPcm } from "../speech/detectSpeech.ts";

/** What the window reports once a CutPlan exists. Seconds, because that is what the user recognises. */
export interface CutSummary {
  recordingSeconds: number;
  keptSeconds: number;
  removedSeconds: number;
  /** Removed share of the Recording, 0 to 1. */
  removedShare: number;
  keepSegments: number;
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
   * The stretches the analysis found worth keeping, before any Margin or MinimumDeadZone was applied. Kept so that
   * those two settings can be changed without reading the Recording again (ADR-0004).
   */
  worthKeeping: readonly TimeRange[];
  cutPlan: CutPlan;
  summary: CutSummary;
}

/** The two settings that only decide how the cuts are planned, not what counts as worth keeping. */
export interface PlanSettings {
  marginSeconds: number;
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
    // ContentEvents and LockedRanges do not exist yet.
    contentEvents: [],
    lockedRanges: [],
    marginSeconds: settings.marginSeconds,
    eventLeadSeconds: 0,
    eventTailSeconds: 0,
    minimumDeadZoneSeconds: settings.minimumDeadZoneSeconds,
  });
  return { ...cut, cutPlan, summary: summariseCutPlan(cut.recording, cutPlan) };
}

/**
 * The whole job behind the Schneiden button: analyse the Recording and measure the plan it produced. The Recording
 * is only read (ADR-0006), and nothing is written until the user picks a place to save.
 */
export async function runCut(request: AnalysisRequest, tools: AnalysisTools): Promise<CutResult> {
  const { recording, listened, worthKeeping, cutPlan } = await analyseRecording(request, tools);
  return { recording, listened, worthKeeping, cutPlan, summary: summariseCutPlan(recording, cutPlan) };
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
