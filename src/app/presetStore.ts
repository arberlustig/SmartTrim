import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Preset } from "./cutSession.ts";
import { ownPresetsText, readOwnPresets } from "./presets.ts";

/** What the file is called inside the folder it is kept in. */
const FILE = "presets.json";

/**
 * Reads the user's own Presets out of a folder. A folder with no preset file in it is the normal first run, not a
 * fault, so it reads as no own Presets.
 */
export async function loadOwnPresets(directory: string): Promise<readonly Preset[]> {
  let text: string;
  try {
    text = await readFile(join(directory, FILE), "utf8");
  } catch (reason) {
    // Only "there is no such file" means none were ever saved. Anything else — a folder in its place, a locked
    // file, a drive that went away — has to reach the user, or their Presets would look deleted and the next save
    // would make that true.
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw reason;
  }
  return readOwnPresets(text);
}

/**
 * Writes the user's own Presets into a folder, making it if this is the first Preset they ever saved.
 *
 * The text goes to a file beside the real one and is renamed into place, because a rename either happens or does
 * not: a crash halfway through can leave a stray `presets.json.writing`, never a half-overwritten `presets.json`.
 * Nothing here stages a crash, so the tests see only the tidying-up, not the guarantee itself (ADR-0018).
 */
export async function storeOwnPresets(directory: string, own: readonly Preset[]): Promise<void> {
  await mkdir(directory, { recursive: true });
  const writing = join(directory, `${FILE}.writing`);
  await writeFile(writing, ownPresetsText(own), "utf8");
  await rename(writing, join(directory, FILE));
}
