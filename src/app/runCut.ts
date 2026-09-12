import { analyseRecording, type AnalysisRequest, type AnalysisTools } from "../analysis/analyseRecording.ts";
import { writeFile } from "node:fs/promises";
import type { CutPlan } from "../cutting/planCuts.ts";
import { exportFcp7Xml, type RecordingInfo } from "../export/exportFcp7Xml.ts";

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
  cutPlan: CutPlan;
  summary: CutSummary;
}

/**
 * The whole job behind the Schneiden button: analyse the Recording and measure the plan it produced. The Recording
 * is only read (ADR-0006), and nothing is written until the user picks a place to save.
 */
export async function runCut(request: AnalysisRequest, tools: AnalysisTools): Promise<CutResult> {
  const { recording, cutPlan } = await analyseRecording(request, tools);
  return { recording, cutPlan, summary: summariseCutPlan(recording, cutPlan) };
}

/** Writes the CutPlan where the user chose, as the FCP7 XML Premiere imports (ADR-0002). */
export async function saveCutPlan(destinationPath: string, recording: RecordingInfo, cutPlan: CutPlan): Promise<void> {
  // The whole file is rendered before the write starts, so a refused destination leaves nothing behind at all.
  const xml = exportFcp7Xml(recording, cutPlan);
  try {
    await writeFile(destinationPath, xml, "utf8");
  } catch (error) {
    // Node's own message is "ENOENT: no such file or directory, open ..."; the window shows this one to the user.
    const reason = (error as { code?: string }).code ?? (error as Error).message;
    throw new Error(`Could not write the Premiere file to ${destinationPath} (${reason}).`, { cause: error });
  }
}
