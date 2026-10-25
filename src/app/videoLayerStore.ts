import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readPremierePresets, type PremierePresetReading } from "../export/premierePreset.ts";
import {
  EMPTY_LIBRARY,
  libraryText,
  readLibrary,
  withPremierePresets,
  type VideoLayerLibrary,
} from "./videoLayerLibrary.ts";

/** What the file is called inside the folder it is kept in, beside `presets.json`. */
const FILE = "videoLayers.json";

/**
 * Reads the PremierePresets and remembered LayerSetups out of a folder. No file is the normal first run; any other
 * reason it cannot be read reaches the user, or the next store would overwrite what they added (ADR-0018).
 */
export async function loadVideoLayerLibrary(directory: string): Promise<VideoLayerLibrary> {
  let text: string;
  try {
    text = await readFile(join(directory, FILE), "utf8");
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_LIBRARY;
    throw reason;
  }
  return readLibrary(text);
}

/**
 * Writes the library into a folder, making it if needed. Written beside and renamed into place, as the preset file
 * is, so a crash leaves a stray `videoLayers.json.writing`, never a half-overwritten library.
 */
export async function storeVideoLayerLibrary(directory: string, library: VideoLayerLibrary): Promise<void> {
  await mkdir(directory, { recursive: true });
  const writing = join(directory, `${FILE}.writing`);
  await writeFile(writing, libraryText(library), "utf8");
  await rename(writing, join(directory, FILE));
}

/** What one `.prfpset` file gave: a reading per preset in it, none for a file that is not one. */
export interface PremierePresetFile {
  path: string;
  readings: readonly PremierePresetReading[];
  /** True when the file could not be read at all — gone, locked, a folder. */
  unreadable: boolean;
}

/**
 * Adds the PremierePresets of `.prfpset` files to the library and stores it. Every file is reported, so the window
 * can say what was added, what was refused and why, and which file held none; one bad file never stops the others.
 */
export async function addPremierePresetFiles(
  directory: string,
  paths: readonly string[],
): Promise<{ library: VideoLayerLibrary; files: readonly PremierePresetFile[] }> {
  const files: PremierePresetFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path, readings: readPremierePresets(await readFile(path, "utf8")), unreadable: false });
    } catch {
      files.push({ path, readings: [], unreadable: true });
    }
  }
  const added = files.flatMap((file) =>
    file.readings.flatMap((reading) => (reading.kind === "read" ? [reading.premierePreset] : [])),
  );
  // Read just before writing, so PremierePresets added in another window meanwhile are not overwritten.
  const library = withPremierePresets(await loadVideoLayerLibrary(directory), added);
  if (added.length > 0) await storeVideoLayerLibrary(directory, library);
  return { library, files };
}

/**
 * A queue for changes to the library file: each runs once the one before has finished, failed or not. Without it two
 * changes close together — a double click — read the file before either wrote it, so one is lost, and both writing
 * through `videoLayers.json.writing` can tear the file, which then reads as an empty library.
 */
export function oneAtATime(): <Result>(change: () => Promise<Result>) => Promise<Result> {
  let last: Promise<unknown> = Promise.resolve();
  return (change) => {
    const next = last.then(change, change);
    last = next.catch(() => undefined);
    return next;
  };
}
