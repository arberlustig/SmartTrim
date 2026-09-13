import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import { probeRecording } from "../probe/probeRecording.ts";
import { openTrimProject } from "../project/openTrimProject.ts";
import type { TrimProject } from "../project/trimProject.ts";
import type { CutResult } from "./runCut.ts";

/** What a file turned out to be once opened. */
export type OpenedFile =
  | { kind: "recording"; recording: RecordingInfo }
  | { kind: "project"; project: TrimProject; cut: CutResult };

/**
 * Opens one file the user handed over by its path alone — dropped on the window or picked in a dialog — as whatever it
 * is: a `.smarttrim` file as the TrimProject it holds, anything else as a Recording, which the probe refuses if it is
 * not one it can cut.
 */
export async function openFile(path: string, ffprobePath: string): Promise<OpenedFile> {
  // A path that cannot be looked at is left to the probe or the read below, which say why in their own words.
  if ((await stat(path).catch(() => null))?.isDirectory()) throw new Error(`${path} is a folder, not a file.`);
  if (extname(path).toLowerCase() === ".smarttrim") {
    return { kind: "project", ...(await openTrimProject(await readFile(path, "utf8"), ffprobePath)) };
  }
  return { kind: "recording", recording: await probeRecording(path, ffprobePath) };
}
