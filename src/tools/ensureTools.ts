import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, type Stats } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AnalysisTools } from "../analysis/analyseRecording.ts";

const execFileAsync = promisify(execFile);

/** One file SmartTrim keeps out of an archive: where it sits inside, and what it must hash to. */
export interface ArchivedFile {
  path: string;
  /**
   * SHA-256 of the file itself. This, not the archive's checksum, says whether an installed file is the pinned one:
   * the same binaries packed into another archive keep it, so moving the download elsewhere downloads nothing again.
   */
  sha256: string;
}

/** One thing SmartTrim needs and does not ship: where to get it, what it must hash to, and what to keep from it. */
export interface ToolSource {
  /** What the window calls it while it downloads. */
  name: string;
  url: string;
  /** SHA-256 of the download itself, checked before anything is unpacked or kept. */
  sha256: string;
  /** Only for the progress the window shows; the checksum is what decides. */
  sizeBytes: number;
  /** For an archive: the files to keep, by their name in the tools directory. */
  unpack?: Readonly<Record<string, ArchivedFile>>;
  /** For a plain file: the name it gets in the tools directory. The download's checksum is the file's own. */
  saveAs?: string;
}

/**
 * How far one source has got. "checking" hashes files that are there but were not checked as they are now;
 * "fetching" downloads them.
 */
export interface ToolProgress {
  name: string;
  step: "checking" | "fetching";
  /**
   * Only while fetching: true when some of the source's files were there and are not the pinned ones — after an
   * update that pins another build, say — so the window does not call it a first start.
   */
  replacing?: boolean;
  doneBytes: number;
  totalBytes: number;
}

/**
 * The record of what was checked, beside the tools. It holds only checksums SmartTrim computed itself, each with the
 * size and modification time its file had then: a start that finds both unchanged trusts the checksum instead of
 * hashing 270 MB again (ADR-0031).
 */
export const VERIFIED_RECORD = "verified.json";

interface VerifiedFile {
  sha256: string;
  size: number;
  mtimeMs: number;
}

type VerifiedRecord = Record<string, VerifiedFile>;

/** The files this source installs, by name in the tools directory, each with the checksum it must have. */
function keptFilesOf(source: ToolSource): { name: string; sha256: string }[] {
  if (source.unpack) return Object.entries(source.unpack).map(([name, file]) => ({ name, sha256: file.sha256 }));
  if (source.saveAs) return [{ name: source.saveAs, sha256: source.sha256 }];
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
async function download(
  source: ToolSource,
  into: string,
  replacing: boolean,
  onProgress?: (step: ToolProgress) => void,
): Promise<void> {
  const response = await fetch(source.url);
  if (!response.ok || !response.body) {
    throw new Error(`${source.name} could not be downloaded from ${source.url}: HTTP ${response.status}.`);
  }
  // The server's own length is only used for the progress bar: a wrong one cannot make a wrong file pass.
  const totalBytes = Number(response.headers.get("content-length") ?? source.sizeBytes) || source.sizeBytes;

  const hash = createHash("sha256");
  const file = await open(into, "w");
  let doneBytes = 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      await file.write(chunk);
      doneBytes += chunk.length;
      onProgress?.({ name: source.name, step: "fetching", replacing, doneBytes, totalBytes });
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

/** SHA-256 of a file on disk, read in large pieces: hashing, not reading, is what takes the time (ADR-0031). */
async function hashFile(path: string, onBytes?: (bytes: number) => void): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 }) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    onBytes?.(chunk.length);
  }
  return hash.digest("hex");
}

/** A tool that comes with Windows, by its full path. */
export function windowsTool(name: string): string {
  return join(process.env["SystemRoot"] ?? String.raw`C:\Windows`, "System32", name);
}

/**
 * Takes the wanted files out of a zip and moves them into place — but only once every one of them hashes to what was
 * pinned for it. Until then nothing in `into` is touched, so a refused download leaves the installed files as they
 * were. Windows unpacks zips itself, so this needs no library.
 */
async function unpack(archivePath: string, into: string, wanted: Readonly<Record<string, ArchivedFile>>): Promise<void> {
  const unpackDir = `${archivePath}-unpacked`;
  await mkdir(unpackDir, { recursive: true });
  try {
    // tar.exe ships with Windows 10 and later and reads zip archives. Called by its full path: a process whose PATH
    // does not carry System32 would otherwise fail with "tar not found" instead of unpacking.
    await execFileAsync(windowsTool("tar.exe"), ["-xf", archivePath, "-C", unpackDir], { windowsHide: true });
    for (const [name, file] of Object.entries(wanted)) {
      const from = join(unpackDir, file.path);
      if (!existsSync(from)) throw new Error(`${file.path} is not in ${archivePath}.`);
      const got = await hashFile(from);
      if (got !== file.sha256) {
        // The archive arrived intact, but holds another build than the one pinned: the pin is wrong, not the download.
        throw new Error(
          `${name} in ${archivePath} is not the file SmartTrim expects (SHA-256 ${got}, expected ${file.sha256}). ` +
            "The installed tools were left as they were.",
        );
      }
    }
    for (const [name, file] of Object.entries(wanted)) await rename(join(unpackDir, file.path), join(into, name));
  } finally {
    await rm(unpackDir, { recursive: true, force: true });
  }
}

/** What an earlier start checked. A missing or unreadable record means nothing was checked: every file is hashed. */
async function readRecord(directory: string): Promise<VerifiedRecord> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, VERIFIED_RECORD), "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as VerifiedRecord) : {};
  } catch {
    return {};
  }
}

/** Written beside and then moved over the old one, so a start that is cut off leaves a whole record or none. */
async function writeRecord(directory: string, record: VerifiedRecord): Promise<void> {
  const temporary = join(directory, `${VERIFIED_RECORD}.new`);
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, join(directory, VERIFIED_RECORD));
}

async function statOf(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

// The record is a file anyone can edit: an entry that is null, or no object at all, is one that was never checked.
const unchangedSince = (file: Stats, checked: VerifiedFile | null | undefined): checked is VerifiedFile =>
  typeof checked === "object" && checked !== null && checked.size === file.size && checked.mtimeMs === file.mtimeMs;

/**
 * Whether this source's files are the pinned ones. A file unchanged since it was checked is judged by the record; any
 * other is hashed, and the record learns the answer either way. Returns null when nothing needs fetching, otherwise
 * whether fetching replaces something that was there.
 */
async function needsFetching(
  directory: string,
  source: ToolSource,
  record: VerifiedRecord,
  onProgress?: (step: ToolProgress) => void,
): Promise<{ replacing: boolean } | null> {
  const files = await Promise.all(
    keptFilesOf(source).map(async (file) => ({ ...file, stats: await statOf(join(directory, file.name)) })),
  );
  let outdated = files.some((file) => file.stats === null);
  const replacing = files.some((file) => file.stats !== null);

  const unchecked = files.filter((file) => file.stats !== null && !unchangedSince(file.stats, record[file.name]));
  for (const file of files) {
    // Checked as it is now, against another pin: this SmartTrim wants other files, and hashing would only say so again.
    if (file.stats && unchangedSince(file.stats, record[file.name]) && record[file.name]?.sha256 !== file.sha256) {
      outdated = true;
    }
  }
  const totalBytes = unchecked.reduce((sum, file) => sum + (file.stats as Stats).size, 0);
  let doneBytes = 0;
  for (const file of unchecked) {
    const stats = file.stats as Stats;
    const got = await hashFile(join(directory, file.name), (bytes) => {
      doneBytes += bytes;
      onProgress?.({ name: source.name, step: "checking", doneBytes, totalBytes });
    });
    record[file.name] = { sha256: got, size: stats.size, mtimeMs: stats.mtimeMs };
    if (got !== file.sha256) outdated = true;
  }
  return outdated ? { replacing } : null;
}

/**
 * Makes sure ffmpeg, ffprobe and the Silero model in `directory` are the files SmartTrim pinned, downloading what is
 * missing or is not what this version pins, and refusing anything whose checksum does not match. Files unchanged since
 * an earlier start checked them are not read again, so this is only slow on a first run and after an update that pins
 * other tools (ADR-0031).
 */
export async function ensureTools(
  directory: string,
  sources: readonly ToolSource[] = PINNED_TOOLS,
  onProgress?: (step: ToolProgress) => void,
): Promise<AnalysisTools> {
  const record = await readRecord(directory);
  const before = JSON.stringify(record);
  const outdated: { source: ToolSource; replacing: boolean }[] = [];
  for (const source of sources) {
    const fetching = await needsFetching(directory, source, record, onProgress);
    if (fetching) outdated.push({ source, ...fetching });
  }
  // What the hashing found is kept even when a download below fails: the next start need not hash it again.
  if (JSON.stringify(record) !== before) await writeRecord(directory, record);
  if (outdated.length === 0) return toolsIn(directory);

  await mkdir(directory, { recursive: true });
  for (const { source, replacing } of outdated) {
    const temporary = join(directory, `${source.saveAs ?? source.name.replace(/[^\w.-]/g, "-")}.part`);
    await download(source, temporary, replacing, onProgress);
    try {
      if (source.unpack) await unpack(temporary, directory, source.unpack);
      else await rename(temporary, join(directory, source.saveAs as string));
    } finally {
      await rm(temporary, { force: true });
    }
    for (const file of keptFilesOf(source)) {
      const stats = await stat(join(directory, file.name));
      record[file.name] = { sha256: file.sha256, size: stats.size, mtimeMs: stats.mtimeMs };
    }
    await writeRecord(directory, record);
  }
  // A directory holding nothing but a failed attempt is tidier gone; an empty one is no tools at all either way.
  if ((await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true });
  return toolsIn(directory);
}

/**
 * What SmartTrim downloads, pinned file by file.
 *
 * ffmpeg is BtbN's LGPL build of 2026-09-30, the last of September, which BtbN keeps for two years (ADR-0031). It
 * answers everything SmartTrim asks of ffmpeg byte for byte as the 2026-09-10 build did that every measurement in the
 * ADRs was made with (bench/compare_ffmpeg_builds.ts). The model is Silero VAD v6.2.1, the one ADR-0010 followed. A
 * new build means new checksums and bench/compare_ffmpeg_builds.ts before the old numbers may be trusted.
 */
export const PINNED_TOOLS: readonly ToolSource[] = [
  {
    name: "ffmpeg",
    url:
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/" +
      "ffmpeg-N-127032-g6ae491a26c-win64-lgpl.zip",
    sha256: "c73ad424c5f9d94dd48815b4d3531e57130cb9f5c3dc8f21f4aa4e1fdb0658e3",
    sizeBytes: 176_142_306,
    unpack: {
      "ffmpeg.exe": {
        path: "ffmpeg-N-127032-g6ae491a26c-win64-lgpl/bin/ffmpeg.exe",
        sha256: "ee76bd5b4525289768485bd2db25993046c24127b3a9a332b02d2aca72377f59",
      },
      "ffprobe.exe": {
        path: "ffmpeg-N-127032-g6ae491a26c-win64-lgpl/bin/ffprobe.exe",
        sha256: "31c13090727a07c25af1b31fd9fcf3c464cea91243cce56ecdcd208e805eb2f0",
      },
      // An LGPL build may not be passed on without its licence.
      "ffmpeg-LICENSE.txt": {
        path: "ffmpeg-N-127032-g6ae491a26c-win64-lgpl/LICENSE.txt",
        sha256: "da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768",
      },
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
