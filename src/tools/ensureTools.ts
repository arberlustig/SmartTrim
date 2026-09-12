import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AnalysisTools } from "../analysis/analyseRecording.ts";

const execFileAsync = promisify(execFile);

/** One thing SmartTrim needs and does not ship: where to get it, what it must hash to, and what to keep from it. */
export interface ToolSource {
  /** What the window calls it while it downloads. */
  name: string;
  url: string;
  /** SHA-256 of the download itself, checked before anything is unpacked or kept. */
  sha256: string;
  /** Only for the progress the window shows; the checksum is what decides. */
  sizeBytes: number;
  /** For an archive: the file to keep, by its name in the tools directory, mapped to its path inside the archive. */
  unpack?: Readonly<Record<string, string>>;
  /** For a plain file: the name it gets in the tools directory. */
  saveAs?: string;
}

/** How far one download has got. */
export interface ToolProgress {
  name: string;
  receivedBytes: number;
  totalBytes: number;
}

/** The files this source installs, by name in the tools directory. */
function productsOf(source: ToolSource): string[] {
  if (source.unpack) return Object.keys(source.unpack);
  if (source.saveAs) return [source.saveAs];
  throw new Error(`${source.name} says neither what to unpack nor what to save.`);
}

/** The three paths the analysis needs, inside a tools directory. */
export function toolsIn(directory: string): AnalysisTools {
  return {
    ffprobe: join(directory, "ffprobe.exe"),
    ffmpeg: join(directory, "ffmpeg.exe"),
    sileroModel: join(directory, "silero_vad.onnx"),
  };
}

/** Downloads to `into`, hashing the bytes as they arrive, and returns nothing but a verified file. */
async function download(source: ToolSource, into: string, onProgress?: (step: ToolProgress) => void): Promise<void> {
  const response = await fetch(source.url);
  if (!response.ok || !response.body) {
    throw new Error(`${source.name} could not be downloaded from ${source.url}: HTTP ${response.status}.`);
  }
  // The server's own length is only used for the progress bar: a wrong one cannot make a wrong file pass.
  const totalBytes = Number(response.headers.get("content-length") ?? source.sizeBytes) || source.sizeBytes;

  const hash = createHash("sha256");
  const file = await open(into, "w");
  let receivedBytes = 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      await file.write(chunk);
      receivedBytes += chunk.length;
      onProgress?.({ name: source.name, receivedBytes, totalBytes });
    }
  } finally {
    await file.close();
  }

  const got = hash.digest("hex");
  if (got !== source.sha256) {
    // A binary that is not the one that was checked is a binary nobody has looked at, and SmartTrim would run it on
    // every Recording. It goes, and the caller hears why.
    await rm(into, { force: true });
    throw new Error(
      `${source.name} from ${source.url} is not the file SmartTrim expects ` +
        `(SHA-256 ${got}, expected ${source.sha256}). Nothing was kept.`,
    );
  }
}

/** A tool that comes with Windows, by its full path. */
export function windowsTool(name: string): string {
  return join(process.env["SystemRoot"] ?? String.raw`C:\Windows`, "System32", name);
}

/** Takes the wanted files out of a zip. Windows unpacks zips itself, so this needs no library. */
async function unpack(archivePath: string, into: string, wanted: Readonly<Record<string, string>>): Promise<void> {
  const unpackDir = `${archivePath}-unpacked`;
  await mkdir(unpackDir, { recursive: true });
  try {
    // tar.exe ships with Windows 10 and later and reads zip archives. Called by its full path: a process whose PATH
    // does not carry System32 would otherwise fail with "tar not found" instead of unpacking.
    await execFileAsync(windowsTool("tar.exe"), ["-xf", archivePath, "-C", unpackDir], { windowsHide: true });
    for (const [name, pathInArchive] of Object.entries(wanted)) {
      const from = join(unpackDir, pathInArchive);
      if (!existsSync(from)) throw new Error(`${pathInArchive} is not in ${archivePath}.`);
      await rename(from, join(into, name));
    }
  } finally {
    await rm(unpackDir, { recursive: true, force: true });
  }
}

/**
 * Makes sure ffmpeg, ffprobe and the Silero model are in `directory`, downloading what is missing and refusing
 * anything whose checksum does not match what SmartTrim pinned. Already installed tools are left alone, so this is
 * only slow on a first run.
 */
export async function ensureTools(
  directory: string,
  sources: readonly ToolSource[] = PINNED_TOOLS,
  onProgress?: (step: ToolProgress) => void,
): Promise<AnalysisTools> {
  const missing = sources.filter((source) => productsOf(source).some((name) => !existsSync(join(directory, name))));
  if (missing.length === 0) return toolsIn(directory);

  await mkdir(directory, { recursive: true });
  for (const source of missing) {
    const temporary = join(directory, `${source.saveAs ?? source.name.replace(/[^\w.-]/g, "-")}.part`);
    await download(source, temporary, onProgress);
    try {
      if (source.unpack) await unpack(temporary, directory, source.unpack);
      else await rename(temporary, join(directory, source.saveAs as string));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  // A directory holding nothing but a failed attempt is tidier gone; an empty one is no tools at all either way.
  if ((await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true });
  return toolsIn(directory);
}

/**
 * What SmartTrim downloads on a first run, pinned by checksum.
 *
 * The ffmpeg build is the exact LGPL build every measurement in the ADRs was made with — its two binaries hash to
 * the same values as the ones that were in `vendor/` while ADR-0004, ADR-0009, ADR-0011 and ADR-0013 were written.
 * The model is Silero VAD v6.2.1, the one ADR-0010 followed. Neither URL may be changed without a new checksum, and
 * a new build means re-running `bench/` before trusting the old numbers.
 */
export const PINNED_TOOLS: readonly ToolSource[] = [
  {
    name: "ffmpeg",
    url:
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-10-15-31/" +
      "ffmpeg-N-126492-gefb0a7e5e7-win64-lgpl.zip",
    sha256: "6681b2b1bf9513514b3241b81ffdc9bbb422bf85fe0a5b179abec4ad1447024b",
    sizeBytes: 172_037_451,
    unpack: {
      "ffmpeg.exe": "ffmpeg-N-126492-gefb0a7e5e7-win64-lgpl/bin/ffmpeg.exe",
      "ffprobe.exe": "ffmpeg-N-126492-gefb0a7e5e7-win64-lgpl/bin/ffprobe.exe",
      // An LGPL build may not be passed on without its licence.
      "ffmpeg-LICENSE.txt": "ffmpeg-N-126492-gefb0a7e5e7-win64-lgpl/LICENSE.txt",
    },
  },
  {
    name: "Silero VAD",
    url: "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.1/src/silero_vad/data/silero_vad.onnx",
    sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
    sizeBytes: 2_327_524,
    saveAs: "silero_vad.onnx",
  },
];
