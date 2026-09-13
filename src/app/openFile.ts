import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import { probeRecording } from "../probe/probeRecording.ts";
import { openTrimProject } from "../project/openTrimProject.ts";
import { readTrimProject, type TrimProject } from "../project/trimProject.ts";
import type { CutResult } from "./runCut.ts";

/** What a file turned out to be once opened. */
export type OpenedFile =
  | { kind: "recording"; recording: RecordingInfo }
  | { kind: "project"; project: TrimProject; cut: CutResult };

/**
 * Why a file did not open. The window words each kind for the user; the message beneath stays the developer's.
 *
 * - `missing`: there is no such file.
 * - `folder`: a folder was handed over where a file was expected.
 * - `notARecording`: ffprobe could not read it at all — a text file, say.
 * - `cannotCut`: ffprobe read it, but SmartTrim refuses to cut it — an MKV without stream lengths (ADR-0009), say.
 * - `notAProject`: a `.smarttrim` file that is damaged, not a project, or from a newer SmartTrim.
 * - `projectRecordingMissing`: the project is fine, but its Recording is not where it was saved; `detail` is where.
 * - `projectRecordingChanged`: its Recording is there but is no longer the one the project was cut from (ADR-0016).
 */
export type RefusalKind =
  | "missing"
  | "folder"
  | "notARecording"
  | "cannotCut"
  | "notAProject"
  | "projectRecordingMissing"
  | "projectRecordingChanged";

/**
 * A file refused while opening, like an exception whose message says what went wrong without where. `detail` is the
 * core of what was reported — ffprobe's own words, or the refusal's sentence — without the path it was wrapped in,
 * which the window shows once, as a file name.
 */
export class FileRefused extends Error {
  constructor(
    readonly kind: RefusalKind,
    message: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** The core of an error about `path`: the last line ffprobe wrote, or the message, without the path in front. */
function coreOf(error: unknown, path: string): string {
  const stderr = ((error as Error).cause as { stderr?: string } | undefined)?.stderr?.trim();
  const said = stderr ? (stderr.split(/\r?\n/).at(-1) as string) : error instanceof Error ? error.message : String(error);
  for (const spelling of [resolve(path), path]) {
    if (said.startsWith(`${spelling}: `)) return said.slice(spelling.length + 2);
    if (said.startsWith(`${spelling} `)) return `It ${said.slice(spelling.length + 1)}`;
  }
  return said;
}

/**
 * Opens one file the user handed over by its path alone — dropped on the window or picked in a dialog — as whatever it
 * is: a `.smarttrim` file as the TrimProject it holds, anything else as a Recording, which the probe refuses if it is
 * not one it can cut. A refusal is a `FileRefused`.
 */
export async function openFile(path: string, ffprobePath: string): Promise<OpenedFile> {
  const found = await stat(path).catch(() => null);
  if (!found) throw new FileRefused("missing", `${path} does not exist.`, "");
  if (found.isDirectory()) throw new FileRefused("folder", `${path} is a folder, not a file.`, "");
  if (extname(path).toLowerCase() === ".smarttrim") return { kind: "project", ...(await openProjectFile(path, ffprobePath)) };
  try {
    return { kind: "recording", recording: await probeRecording(path, ffprobePath) };
  } catch (error) {
    // The probe wraps a failed ffprobe run with its cause; a Recording it read and refused carries none.
    const kind = (error as Error).cause ? "notARecording" : "cannotCut";
    throw new FileRefused(kind, (error as Error).message, coreOf(error, path), { cause: error });
  }
}

/**
 * Opens a `.smarttrim` file, telling apart the three ways that fails: the file is no project, its Recording is gone,
 * or its Recording has changed. Each asks something different of the user.
 */
async function openProjectFile(path: string, ffprobePath: string): ReturnType<typeof openTrimProject> {
  const text = await readFile(path, "utf8");
  let project: TrimProject;
  try {
    project = readTrimProject(text);
  } catch (error) {
    throw new FileRefused("notAProject", (error as Error).message, coreOf(error, path), { cause: error });
  }
  const recordingPath = project.recording.path;
  if (!(await stat(recordingPath).catch(() => null))) {
    throw new FileRefused("projectRecordingMissing", `The Recording ${recordingPath} this project was cut from is gone.`, recordingPath);
  }
  try {
    return await openTrimProject(text, ffprobePath);
  } catch (error) {
    throw new FileRefused("projectRecordingChanged", (error as Error).message, coreOf(error, recordingPath), { cause: error });
  }
}

/** A file that did not open, and why. */
export interface Refusal {
  path: string;
  kind: RefusalKind;
  detail: string;
}

/** Several files handed over at once: what opened, each with the path it came from, and what did not, with why. */
export interface OpenedFiles {
  opened: readonly (OpenedFile & { path: string })[];
  refused: readonly Refusal[];
}

/** "Part2" before "Part10", the way Explorer sorts, rather than character by character. */
const naturalOrder = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

/**
 * The paths to open: a file as it is, a folder as the files directly inside it — never the folders within, and never
 * the Premiere files SmartTrim writes beside the Recordings, which would otherwise come back as refusals every time
 * the folder is dropped again.
 */
async function filesIn(path: string): Promise<string[]> {
  if (!(await stat(path).catch(() => null))?.isDirectory()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() !== ".xml")
    .map((entry) => join(path, entry.name))
    .sort(naturalOrder.compare);
}

/**
 * Opens every file handed over — dropped together, picked together, or lying in a dropped folder — each on its own. A
 * file that cannot be opened does not stop the others; it comes back with the reason.
 */
export async function openFiles(paths: readonly string[], ffprobePath: string): Promise<OpenedFiles> {
  const files = (await Promise.all(paths.map(filesIn))).flat();
  const outcomes = await Promise.allSettled(files.map((path) => openFile(path, ffprobePath)));
  const opened: (OpenedFile & { path: string })[] = [];
  const refused: Refusal[] = [];
  outcomes.forEach((outcome, at) => {
    const path = files[at] as string;
    if (outcome.status === "rejected") {
      const { reason } = outcome;
      // Anything that is not a FileRefused is a fault nobody foresaw; its message is all there is to show.
      refused.push(
        reason instanceof FileRefused
          ? { path, kind: reason.kind, detail: reason.detail }
          : { path, kind: "cannotCut", detail: coreOf(reason, path) },
      );
      return;
    }
    const file = { ...outcome.value, path };
    // One Recording opens once. Its project wins over the bare Recording, since the project holds the work done on it,
    // and takes the place of whichever of the two came first.
    const twin = opened.findIndex((each) => sameRecording(recordingPathOf(each), recordingPathOf(file)));
    if (twin === -1) opened.push(file);
    else if (file.kind === "project" && opened[twin]?.kind === "recording") opened[twin] = file;
  });
  return { opened, refused };
}

/** The Recording an opened file stands for: itself, or the one a project was cut from. */
export function recordingPathOf(file: OpenedFile): string {
  return file.kind === "recording" ? file.recording.path : file.cut.recording.path;
}

/**
 * Whether two paths name the same Recording. Windows paths ignore case and take either slash, so `C:\A\x.mp4` and
 * `c:/a/X.MP4` are one file; SmartTrim runs on Windows only.
 */
export function sameRecording(one: string, other: string): boolean {
  return resolve(one).toLowerCase() === resolve(other).toLowerCase();
}
