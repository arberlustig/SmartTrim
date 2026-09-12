import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Preset } from "./cutSession";
import { loadOwnPresets, storeOwnPresets } from "./presetStore";

const abend: Preset = {
  name: "Abend",
  thresholdDbfs: -38,
  marginSeconds: 0.08,
  eventLeadSeconds: 1,
  eventTailSeconds: 1.5,
  minimumDeadZoneSeconds: 0.4,
};

describe("the preset file in the user's folder", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-presets-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("gives no own Presets when the folder holds none yet, rather than failing on a first run", async () => {
    await expect(loadOwnPresets(join(workDir, "never-written"))).resolves.toEqual([]);
  });

  test("hands back what was saved, as a later start of the app would find it", async () => {
    const morgen: Preset = { ...abend, name: "Morgen", thresholdDbfs: -52 };
    const folder = join(workDir, "restart");
    await storeOwnPresets(folder, [abend, morgen]);
    await expect(loadOwnPresets(folder)).resolves.toEqual([abend, morgen]);
  });

  /**
   * Saving writes beside the preset file and renames it into place, so a crash mid-write cannot leave the user's
   * Presets half overwritten. These two check what that leaves visible — the crash itself is not staged here.
   */
  test("leaves nothing behind but the preset file", async () => {
    const folder = join(workDir, "tidy");
    await storeOwnPresets(folder, [abend]);
    await storeOwnPresets(folder, [abend, { ...abend, name: "Morgen" }]);
    expect(readdirSync(folder)).toEqual(["presets.json"]);
  });

  test("ignores a half-written file left behind by an earlier crash", async () => {
    const folder = join(workDir, "leftover");
    await storeOwnPresets(folder, [abend]);
    writeFileSync(join(folder, "presets.json.writing"), `{ "smarttrimPresets": 1, "presets": [ { "na`);
    await expect(loadOwnPresets(folder)).resolves.toEqual([abend]);
  });

  // Only a missing file means "none saved yet". Any other reason the file cannot be read has to reach the user,
  // or their Presets would look deleted and the next save would make that true.
  test("refuses when the preset file cannot be read for any reason but being absent", async () => {
    const folder = join(workDir, "unreadable");
    mkdirSync(join(folder, "presets.json"), { recursive: true });
    await expect(loadOwnPresets(folder)).rejects.toThrow();
  });

  // A guard, not a driver: the refusal itself is settled in presets.test.ts. This one keeps the file layer from
  // swallowing it later by widening its "file is missing" catch.
  test("lets a refusal from a newer SmartTrim's file through instead of swallowing it", async () => {
    const folder = join(workDir, "newer");
    await storeOwnPresets(folder, [abend]);
    writeFileSync(join(folder, "presets.json"), `{ "smarttrimPresets": 99, "presets": [] }`);
    await expect(loadOwnPresets(folder)).rejects.toThrow(/neuere/i);
  });
});
