import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ensureTools, windowsTool, type ToolSource } from "./ensureTools";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("ensureTools", () => {
  let workDir: string;
  let server: Server;
  let origin: string;
  /** What the fake download host was asked for, so a second run can be shown not to download anything. */
  let requested: string[] = [];
  let archive: Buffer;
  let model: Buffer;
  let sources: readonly ToolSource[];

  /**
   * A stand-in for the two real downloads: a zip holding the binaries inside a folder, the way BtbN's ffmpeg build
   * does, and a plain file for the Silero model. Windows unpacks the zip itself, so the test builds a real one.
   */
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-tools-"));
    const packDir = join(workDir, "pack", "ffmpeg-fake-win64-lgpl", "bin");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "ffmpeg.exe"), "fake ffmpeg");
    writeFileSync(join(packDir, "ffprobe.exe"), "fake ffprobe");
    writeFileSync(join(workDir, "pack", "ffmpeg-fake-win64-lgpl", "LICENSE.txt"), "fake license");
    const archivePath = join(workDir, "ffmpeg.zip");
    execFileSync(windowsTool(String.raw`WindowsPowerShell\v1.0\powershell.exe`), [
      ...["-NoProfile", "-Command"],
      `Compress-Archive -Path '${join(workDir, "pack", "ffmpeg-fake-win64-lgpl")}' -DestinationPath '${archivePath}' -Force`,
    ]);
    archive = readFileSync(archivePath);
    model = Buffer.from("fake silero model");

    server = createServer((request, response) => {
      requested.push(request.url ?? "");
      if (request.url === "/ffmpeg.zip") response.end(archive);
      else if (request.url === "/silero.onnx") response.end(model);
      // The tampered file answers with something else than what its checksum promises.
      else if (request.url === "/tampered.onnx") response.end(Buffer.from("not the model at all"));
      else response.writeHead(404).end();
    });
    await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
    const { port } = server.address() as { port: number };
    origin = `http://127.0.0.1:${port}`;

    sources = [
      {
        name: "ffmpeg",
        url: `${origin}/ffmpeg.zip`,
        sha256: sha256(archive),
        sizeBytes: archive.length,
        unpack: {
          "ffmpeg.exe": "ffmpeg-fake-win64-lgpl/bin/ffmpeg.exe",
          "ffprobe.exe": "ffmpeg-fake-win64-lgpl/bin/ffprobe.exe",
          "ffmpeg-LICENSE.txt": "ffmpeg-fake-win64-lgpl/LICENSE.txt",
        },
      },
      { name: "Silero VAD", url: `${origin}/silero.onnx`, sha256: sha256(model), sizeBytes: model.length, saveAs: "silero_vad.onnx" },
    ];
  });
  afterAll(() => {
    server.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("what is missing is downloaded, checked against its checksum and unpacked", async () => {
    const toolsDir = join(workDir, "first-run");
    const progress: string[] = [];

    const tools = await ensureTools(toolsDir, sources, (step) =>
      progress.push(`${step.name} ${step.receivedBytes}/${step.totalBytes}`),
    );

    expect(readFileSync(tools.ffmpeg, "utf8")).toBe("fake ffmpeg");
    expect(readFileSync(tools.ffprobe, "utf8")).toBe("fake ffprobe");
    expect(readFileSync(tools.sileroModel, "utf8")).toBe("fake silero model");
    // The licence travels with the binaries: an LGPL build may not be handed on without it.
    expect(existsSync(join(toolsDir, "ffmpeg-LICENSE.txt"))).toBe(true);
    // A 172 MB download needs to say how far it has got.
    expect(progress.some((step) => step.startsWith("ffmpeg "))).toBe(true);
    expect(progress.at(-1)).toBe(`Silero VAD ${model.length}/${model.length}`);
  });

  test("tools that are already there are not downloaded again", async () => {
    const toolsDir = join(workDir, "second-run");
    await ensureTools(toolsDir, sources);
    requested = [];

    const tools = await ensureTools(toolsDir, sources);

    expect(requested).toEqual([]);
    expect(existsSync(tools.ffmpeg)).toBe(true);
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
});
