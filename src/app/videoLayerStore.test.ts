import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RAW_V1 } from "../testing/premierePresets.ts";
import { EMPTY_LIBRARY, withLayerSetupRemembered, withPremierePresets } from "./videoLayerLibrary.ts";
import { addPremierePresetFiles, loadVideoLayerLibrary, oneAtATime, storeVideoLayerLibrary } from "./videoLayerStore.ts";

const library = withLayerSetupRemembered(withPremierePresets(EMPTY_LIBRARY, [RAW_V1]), "32:9", [
  { clipPremierePreset: RAW_V1, nestPremierePreset: undefined, startsSwitchedOff: false },
]);

describe("the video layer library in the user's folder", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-video-layers-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("is empty on a first run, when the folder holds no library yet", async () => {
    await expect(loadVideoLayerLibrary(join(workDir, "never-written"))).resolves.toEqual(EMPTY_LIBRARY);
  });

  test("hands back what was stored, leaving nothing behind but its file", async () => {
    const folder = join(workDir, "restart");
    await storeVideoLayerLibrary(folder, EMPTY_LIBRARY);
    await storeVideoLayerLibrary(folder, library);
    await expect(loadVideoLayerLibrary(folder)).resolves.toEqual(library);
    expect(readdirSync(folder)).toEqual(["videoLayers.json"]);
  });

  test("refuses when the file cannot be read for any reason but being absent", async () => {
    const folder = join(workDir, "unreadable");
    mkdirSync(join(folder, "videoLayers.json"), { recursive: true });
    await expect(loadVideoLayerLibrary(folder)).rejects.toThrow();
  });
});

describe("adding .prfpset files to the library", () => {
  let workDir: string;
  const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/premiere/video-layers/${name}`, import.meta.url));

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-add-presets-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("adds what each file holds, keeps it for the next start, and says per file what was read or refused", async () => {
    const folder = join(workDir, "add");
    const animated = join(workDir, "animated.prfpset");
    writeFileSync(
      animated,
      readFileSync(fixture("raw-v3.prfpset"), "utf8").replace("<IsTimeVarying>false", "<IsTimeVarying>true"),
    );
    const notAPreset = fixture("4-nested.xml");

    const { library, files } = await addPremierePresetFiles(folder, [fixture("raw-v1.prfpset"), animated, notAPreset]);

    expect(library.premierePresets.map((premierePreset) => premierePreset.name)).toEqual(["RAWCUT - V1"]);
    expect(await loadVideoLayerLibrary(folder)).toEqual(library);
    expect(files.map((file) => [file.path, file.readings.map((reading) => reading.kind)])).toEqual([
      [fixture("raw-v1.prfpset"), ["read"]],
      [animated, ["refused"]],
      [notAPreset, []],
    ]);
  });

  test("a file that cannot be read at all is reported, and the others are still added", async () => {
    const folder = join(workDir, "missing");
    const { library, files } = await addPremierePresetFiles(folder, [join(workDir, "gone.prfpset"), fixture("raw-v2.prfpset")]);
    expect(library.premierePresets.map((premierePreset) => premierePreset.name)).toEqual(["RAWCUT - V2"]);
    expect(files[0]?.unreadable).toBe(true);
  });
});

describe("oneAtATime", () => {
  // Two changes to videoLayers.json that overlap would each read the file before the other wrote it: one change is
  // lost, and both writing through one temporary file can tear it. Every change goes through one queue instead.
  test("runs each change only after the one before has finished, in the order they came", async () => {
    const queue = oneAtATime();
    const steps: string[] = [];
    const change = (name: string, ms: number) =>
      queue(async () => {
        steps.push(`${name} reads`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        steps.push(`${name} writes`);
        return name;
      });
    expect(await Promise.all([change("delete", 20), change("remember", 1)])).toEqual(["delete", "remember"]);
    expect(steps).toEqual(["delete reads", "delete writes", "remember reads", "remember writes"]);
  });

  test("a change that fails does not hold up the next", async () => {
    const queue = oneAtATime();
    const failing = queue(async () => {
      throw new Error("disk gone");
    });
    await expect(failing).rejects.toThrow("disk gone");
    await expect(queue(async () => "next")).resolves.toBe("next");
  });
});
