import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RAW_V1 } from "../testing/premierePresets.ts";
import { EMPTY_LIBRARY, withLayerSetupRemembered, withPremierePresets } from "./videoLayerLibrary.ts";
import { loadVideoLayerLibrary, storeVideoLayerLibrary } from "./videoLayerStore.ts";

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
