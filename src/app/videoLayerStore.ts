import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_LIBRARY, libraryText, readLibrary, type VideoLayerLibrary } from "./videoLayerLibrary.ts";

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
