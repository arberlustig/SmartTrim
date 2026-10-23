import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PINNED_TOOLS, VERIFIED_RECORD, ensureTools, windowsTool, type ToolProgress, type ToolSource } from "./ensureTools";

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

describe("ensureTools", () => {
  let workDir: string;
  let server: Server;
  let origin: string;
  /** What the fake download host was asked for, so a run can be shown not to download anything. */
  let requested: string[] = [];
  /** Every zip the fake host serves, by its path on the host. */
  const zips = new Map<string, Buffer>();
  let model: Buffer;

  /**
   * Makes real zips, each holding the three ffmpeg files inside a folder, the way BtbN's build does, and hands them to
   * the fake host by name. Windows unpacks zips itself, so the test builds real ones rather than pretending — all in
   * one PowerShell, which takes seconds to start.
   */
  function makeZips(zipsToMake: { name: string; folder: string; files: { ffmpeg: string; ffprobe: string; license: string } }[]): void {
    const commands = zipsToMake.map(({ name, folder, files }) => {
      const binDir = join(workDir, "pack", name, folder, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "ffmpeg.exe"), files.ffmpeg);
      writeFileSync(join(binDir, "ffprobe.exe"), files.ffprobe);
      writeFileSync(join(workDir, "pack", name, folder, "LICENSE.txt"), files.license);
      return `Compress-Archive -Path '${join(workDir, "pack", name, folder)}' -DestinationPath '${join(workDir, `${name}.zip`)}' -Force`;
    });
    execFileSync(windowsTool(String.raw`WindowsPowerShell\v1.0\powershell.exe`), ["-NoProfile", "-Command", commands.join("; ")]);
    for (const { name } of zipsToMake) zips.set(`/${name}.zip`, readFileSync(join(workDir, `${name}.zip`)));
  }

  const FIRST = { ffmpeg: "fake ffmpeg", ffprobe: "fake ffprobe", license: "fake license" };
  const SECOND = { ffmpeg: "fake ffmpeg, a later build", ffprobe: "fake ffprobe, a later build", license: "fake license" };

  /** An ffmpeg source as PINNED_TOOLS writes one: the zip's checksum, and every kept file with its own. */
  function ffmpegSource(zipName: string, folder: string, files: typeof FIRST): ToolSource {
    const zip = zips.get(`/${zipName}.zip`) as Buffer;
    return {
      name: "ffmpeg",
      url: `${origin}/${zipName}.zip`,
      sha256: sha256(zip),
      sizeBytes: zip.length,
      unpack: {
        "ffmpeg.exe": { path: `${folder}/bin/ffmpeg.exe`, sha256: sha256(files.ffmpeg) },
        "ffprobe.exe": { path: `${folder}/bin/ffprobe.exe`, sha256: sha256(files.ffprobe) },
        "ffmpeg-LICENSE.txt": { path: `${folder}/LICENSE.txt`, sha256: sha256(files.license) },
      },
    };
  }

  let silero: ToolSource;
  let sources: readonly ToolSource[];

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-tools-"));
    server = createServer((request, response) => {
      requested.push(request.url ?? "");
      const zip = zips.get(request.url ?? "");
      if (zip) response.end(zip);
      else if (request.url === "/silero.onnx") response.end(model);
      // The tampered file answers with something else than what its checksum promises.
      else if (request.url === "/tampered.onnx") response.end(Buffer.from("not the model at all"));
      else response.writeHead(404).end();
    });
    await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
    const { port } = server.address() as { port: number };
    origin = `http://127.0.0.1:${port}`;

    makeZips([
      { name: "ffmpeg", folder: "ffmpeg-fake-win64-lgpl", files: FIRST },
      // The same three files packed again under another folder name, so the zip hashes differently: what moving the
      // download to another host or build archive does.
      { name: "rehosted", folder: "ffmpeg-rehosted-win64-lgpl", files: FIRST },
      { name: "later", folder: "ffmpeg-later-win64-lgpl", files: SECOND },
      // A zip that is exactly what its own checksum says, holding files that are not the ones pinned for them.
      { name: "mislabelled", folder: "ffmpeg-fake-win64-lgpl", files: SECOND },
    ]);
    model = Buffer.from("fake silero model");

    silero = { name: "Silero VAD", url: `${origin}/silero.onnx`, sha256: sha256(model), sizeBytes: model.length, saveAs: "silero_vad.onnx" };
    sources = [ffmpegSource("ffmpeg", "ffmpeg-fake-win64-lgpl", FIRST), silero];
    // PowerShell alone takes several seconds to start when the other test files run beside it.
  }, 60_000);
  afterAll(() => {
    server.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  /** A tools directory as a first run leaves it, and the requests cleared so the next run starts counting at nought. */
  async function installed(name: string): Promise<string> {
    const toolsDir = join(workDir, name);
    await ensureTools(toolsDir, sources);
    requested = [];
    return toolsDir;
  }

  /** Runs ensureTools and keeps every progress step it reported. */
  async function run(toolsDir: string, withSources: readonly ToolSource[]): Promise<ToolProgress[]> {
    const progress: ToolProgress[] = [];
    await ensureTools(toolsDir, withSources, (step) => progress.push(step));
    return progress;
  }

  const record = (toolsDir: string) => JSON.parse(readFileSync(join(toolsDir, VERIFIED_RECORD), "utf8"));

  test("what is missing is downloaded, checked against its checksum and unpacked", async () => {
    const toolsDir = join(workDir, "first-run");

    const progress = await run(toolsDir, sources);

    const tools = await ensureTools(toolsDir, sources);
    expect(readFileSync(tools.ffmpeg, "utf8")).toBe("fake ffmpeg");
    expect(readFileSync(tools.ffprobe, "utf8")).toBe("fake ffprobe");
    expect(readFileSync(tools.sileroModel, "utf8")).toBe("fake silero model");
    // The licence travels with the binaries: an LGPL build may not be handed on without it.
    expect(readFileSync(join(toolsDir, "ffmpeg-LICENSE.txt"), "utf8")).toBe("fake license");
    // A 176 MB download needs to say how far it has got — and that nothing was there before, so "first start only".
    expect(progress.some((step) => step.name === "ffmpeg" && step.step === "fetching" && !step.replacing)).toBe(true);
    expect(progress.at(-1)).toEqual({ name: "Silero VAD", step: "fetching", replacing: false, doneBytes: model.length, totalBytes: model.length });
  });

  test("the record holds every kept file's own checksum, size and time, as checked", async () => {
    const toolsDir = await installed("recorded");

    const kept = record(toolsDir);

    expect(Object.keys(kept).sort()).toEqual(["ffmpeg-LICENSE.txt", "ffmpeg.exe", "ffprobe.exe", "silero_vad.onnx"]);
    const ffmpeg = statSync(join(toolsDir, "ffmpeg.exe"));
    expect(kept["ffmpeg.exe"]).toEqual({ sha256: sha256(FIRST.ffmpeg), size: ffmpeg.size, mtimeMs: ffmpeg.mtimeMs });
    expect(kept["silero_vad.onnx"].sha256).toBe(sha256(model));
  });

  test("tools that are already there and unchanged are neither downloaded nor hashed again", async () => {
    const toolsDir = await installed("second-run");

    const progress = await run(toolsDir, sources);

    expect(requested).toEqual([]);
    // Hashing 270 MB takes most of a second; a start with nothing new must not pay for it.
    expect(progress).toEqual([]);
  });

  // A binary that is not the one that was checked is a binary nobody has looked at; SmartTrim would then run it on
  // every Recording the owner has.
  test("a download that does not match its checksum is refused and nothing of it is kept", async () => {
    const toolsDir = join(workDir, "tampered");
    const tampered: readonly ToolSource[] = [
      { name: "Silero VAD", url: `${origin}/tampered.onnx`, sha256: sha256(model), sizeBytes: model.length, saveAs: "silero_vad.onnx" },
    ];

    await expect(ensureTools(toolsDir, tampered)).rejects.toThrow("Silero VAD");

    expect(existsSync(join(toolsDir, "silero_vad.onnx"))).toBe(false);
    // Not even a half-written temporary file may stay behind.
    expect(existsSync(toolsDir) ? readdirSync(toolsDir) : []).toEqual([]);
  });

  // SmartTrim 1.1.0 wrote no record. Its files are checked once by their own checksums; the download address may have
  // moved meanwhile (it had to: the pinned one was deleted), and the same files must not be downloaded for nothing.
  test.each([
    ["no record at all, as SmartTrim 1.1.0 left it", (toolsDir: string) => rmSync(join(toolsDir, VERIFIED_RECORD))],
    ["an unreadable record", (toolsDir: string) => writeFileSync(join(toolsDir, VERIFIED_RECORD), "{ not json")],
    ["a record whose entries were edited away", (toolsDir: string) =>
      writeFileSync(join(toolsDir, VERIFIED_RECORD), JSON.stringify({ "ffmpeg.exe": null, "ffprobe.exe": "checked", "silero_vad.onnx": 5 }))],
  ])("an installation with %s is checked once, and the same files are not downloaded again", async (_case, damage) => {
    const toolsDir = await installed(`unrecorded-${_case.length}`);
    damage(toolsDir);
    const rehosted = [ffmpegSource("rehosted", "ffmpeg-rehosted-win64-lgpl", FIRST), silero];

    const checking = await run(toolsDir, rehosted);
    const after = await run(toolsDir, rehosted);

    expect(requested).toEqual([]);
    expect(checking.some((step) => step.name === "ffmpeg" && step.step === "checking")).toBe(true);
    expect(checking.some((step) => step.step === "fetching")).toBe(false);
    expect(Object.keys(record(toolsDir)).sort()).toEqual(["ffmpeg-LICENSE.txt", "ffmpeg.exe", "ffprobe.exe", "silero_vad.onnx"]);
    // Once checked, the next start trusts the record again.
    expect(after).toEqual([]);
  });

  test("a new download address for the same files downloads nothing", async () => {
    const toolsDir = await installed("moved-address");
    const before = statSync(join(toolsDir, "ffmpeg.exe")).mtimeMs;

    const progress = await run(toolsDir, [ffmpegSource("rehosted", "ffmpeg-rehosted-win64-lgpl", FIRST), silero]);

    expect(requested).toEqual([]);
    expect(progress).toEqual([]);
    expect(statSync(join(toolsDir, "ffmpeg.exe")).mtimeMs).toBe(before);
  });

  // An updated SmartTrim may pin another build. Without this, an updated installation would keep the old one for ever
  // while a fresh one gets the new: two machines, same version, different ffmpeg.
  test("a pin that moves to other files replaces them, and only that source is downloaded", async () => {
    const toolsDir = await installed("new-pin");
    const later = [ffmpegSource("later", "ffmpeg-later-win64-lgpl", SECOND), silero];

    const progress = await run(toolsDir, later);

    expect(requested).toEqual(["/later.zip"]);
    expect(readFileSync(join(toolsDir, "ffmpeg.exe"), "utf8")).toBe(SECOND.ffmpeg);
    expect(readFileSync(join(toolsDir, "ffprobe.exe"), "utf8")).toBe(SECOND.ffprobe);
    // Not "first start only": there was an ffmpeg, and it is being replaced.
    expect(progress.filter((step) => step.step === "fetching").every((step) => step.replacing)).toBe(true);
    // The record already said these were other files, so nothing needed hashing to find out.
    expect(progress.some((step) => step.step === "checking")).toBe(false);
    expect(record(toolsDir)["ffmpeg.exe"].sha256).toBe(sha256(SECOND.ffmpeg));
  });

  test("a file changed by hand is found and replaced by the pinned one", async () => {
    const toolsDir = await installed("hand-changed");
    writeFileSync(join(toolsDir, "ffprobe.exe"), "some other ffprobe someone put here");

    const progress = await run(toolsDir, sources);

    expect(requested).toEqual(["/ffmpeg.zip"]);
    expect(readFileSync(join(toolsDir, "ffprobe.exe"), "utf8")).toBe(FIRST.ffprobe);
    expect(progress.some((step) => step.step === "checking")).toBe(true);
    expect(progress.filter((step) => step.step === "fetching").every((step) => step.replacing)).toBe(true);
  });

  test("a file whose time changed but whose bytes are the pinned ones is checked, not downloaded", async () => {
    const toolsDir = await installed("touched");
    utimesSync(join(toolsDir, "ffmpeg.exe"), new Date(2027, 0, 1), new Date(2027, 0, 1));

    const checking = await run(toolsDir, sources);
    const after = await run(toolsDir, sources);

    expect(requested).toEqual([]);
    expect(checking.some((step) => step.step === "checking")).toBe(true);
    expect(record(toolsDir)["ffmpeg.exe"].mtimeMs).toBe(statSync(join(toolsDir, "ffmpeg.exe")).mtimeMs);
    expect(after).toEqual([]);
  });

  test("one missing file of an archive brings the whole archive again, and says it replaces", async () => {
    const toolsDir = await installed("one-missing");
    rmSync(join(toolsDir, "ffmpeg-LICENSE.txt"));

    const progress = await run(toolsDir, sources);

    expect(requested).toEqual(["/ffmpeg.zip"]);
    expect(readFileSync(join(toolsDir, "ffmpeg-LICENSE.txt"), "utf8")).toBe(FIRST.license);
    expect(progress.filter((step) => step.step === "fetching").every((step) => step.replacing)).toBe(true);
  });

  // The zip's own checksum says the download arrived intact; only the kept files' checksums say it holds the build the
  // measurements were made with. A pin that got one of them wrong must not slip a different binary in.
  test("a download whose files are not the pinned ones is refused, and the installed files stay as they were", async () => {
    const toolsDir = await installed("mislabelled");
    rmSync(join(toolsDir, "ffmpeg-LICENSE.txt"));
    // The zip's checksum is the mislabelled zip's own; the kept files are pinned as the first build's.
    const mislabelled = ffmpegSource("mislabelled", "ffmpeg-fake-win64-lgpl", FIRST);

    const refusal = ensureTools(toolsDir, [mislabelled, silero]);

    await expect(refusal).rejects.toThrow(/ffmpeg\.exe.*is not the file SmartTrim expects/);
    await expect(ensureTools(toolsDir, [mislabelled, silero])).rejects.toThrow(sha256(SECOND.ffmpeg));
    expect(readFileSync(join(toolsDir, "ffmpeg.exe"), "utf8")).toBe(FIRST.ffmpeg);
    // Neither the download nor its unpacked files stay behind.
    expect(readdirSync(toolsDir).sort()).toEqual(["ffmpeg.exe", "ffprobe.exe", "silero_vad.onnx", VERIFIED_RECORD].sort());
  });
});

describe("PINNED_TOOLS", () => {
  // Every installation downloads these again the moment one of them changes, and the measurements in the ADRs hold for
  // exactly these binaries. Moving them needs bench/compare_ffmpeg_builds.ts and an ADR (ADR-0031).
  test("pins ffmpeg N-127032 and Silero VAD v6.2.1, file by file", () => {
    const kept = Object.fromEntries(
      PINNED_TOOLS.flatMap((source) =>
        source.unpack
          ? Object.entries(source.unpack).map(([name, file]) => [name, file.sha256])
          : [[source.saveAs, source.sha256]],
      ),
    );
    expect(kept).toEqual({
      "ffmpeg.exe": "ee76bd5b4525289768485bd2db25993046c24127b3a9a332b02d2aca72377f59",
      "ffprobe.exe": "31c13090727a07c25af1b31fd9fcf3c464cea91243cce56ecdcd208e805eb2f0",
      "ffmpeg-LICENSE.txt": "da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768",
      "silero_vad.onnx": "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
    });
  });
});
