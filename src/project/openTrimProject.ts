import { writeFile } from "node:fs/promises";
import type { Decision } from "../analysis/analyseRecording.ts";
import { replanCut, type CutResult } from "../app/runCut.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import { probeRecording } from "../probe/probeRecording.ts";
import { readTrimProject, trimProjectText, type TrimProject } from "./trimProject.ts";

/** What the user chose, as the window holds it, for a project about to be saved. */
export interface SavedChoices {
  voiceSourceTracks: readonly number[];
  exportSourceTracks: readonly number[];
  decideBy?: Decision;
  marginSeconds: number;
  minimumDeadZoneSeconds: number;
  scan?: TrimProject["scan"];
}

/** Turns a finished cut and the choices behind it into the session that gets saved. */
export function trimProjectOf(cut: CutResult, choices: SavedChoices): TrimProject {
  const project: TrimProject = {
    recording: cut.recording,
    listenTo: [...choices.voiceSourceTracks],
    exportSourceTracks: [...choices.exportSourceTracks],
    decideBy: choices.decideBy ?? { kind: "voice" },
    marginSeconds: choices.marginSeconds,
    minimumDeadZoneSeconds: choices.minimumDeadZoneSeconds,
    worthKeeping: cut.worthKeeping,
  };
  const { scan } = choices;
  return scan ? { ...project, scan } : project;
}

/** Writes a session as a `.smarttrim` file, naming the place when that fails. */
export async function saveTrimProject(destinationPath: string, project: TrimProject): Promise<void> {
  const text = trimProjectText(project);
  try {
    await writeFile(destinationPath, text, "utf8");
  } catch (error) {
    const reason = (error as { code?: string }).code ?? (error as Error).message;
    throw new Error(`Could not write the SmartTrim project to ${destinationPath} (${reason}).`, { cause: error });
  }
}

/** The timing a CutPlan was planned against. Everything else may differ: the export reads it from the file as it is. */
function timingOf(recording: RecordingInfo): string {
  const rate = `${recording.frameRate.numerator}/${recording.frameRate.denominator}`;
  const lengths = recording.sourceTracks.map((sourceTrack) => sourceTrack.durationFrames).join(",");
  return `${recording.durationFrames} frames at ${rate} fps, SourceTracks ${lengths}`;
}

/**
 * Reopens a saved session: reads the file, probes the Recording it names, and plans the cuts again from the
 * stretches the analysis had found — so nothing is read but the stream descriptions (ADR-0004).
 *
 * The Recording has to be the one the project was cut from. Every position in a CutPlan is a frame of that
 * particular file; against a re-exported or trimmed one they would point somewhere else, or past its end. The
 * Recording as it is now is what comes back, so a file that only looks different (another resolution, say) is used
 * as it is rather than as it was.
 */
export async function openTrimProject(
  text: string,
  ffprobePath: string,
): Promise<{ project: TrimProject; cut: CutResult }> {
  const project = readTrimProject(text);
  const recording = await probeRecording(project.recording.path, ffprobePath);

  if (timingOf(recording) !== timingOf(project.recording)) {
    throw new Error(
      `${recording.path} is no longer the Recording this project was cut from: ` +
        `it now holds ${timingOf(recording)}, the project was cut from ${timingOf(project.recording)}.`,
    );
  }

  const cut = replanCut(
    // The audio itself was not saved, so a new threshold would have to read the Recording again.
    { recording, listened: [], worthKeeping: project.worthKeeping, cutPlan: [], summary: EMPTY_SUMMARY },
    { marginSeconds: project.marginSeconds, minimumDeadZoneSeconds: project.minimumDeadZoneSeconds },
  );
  return { project, cut };
}

/** Stands in until `replanCut` measures the plan it just made. */
const EMPTY_SUMMARY = {
  recordingSeconds: 0,
  keptSeconds: 0,
  removedSeconds: 0,
  removedShare: 0,
  keepSegments: 0,
} as const;
