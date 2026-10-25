import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { readPremierePresets } from "../export/premierePreset.ts";
import type { VideoLayer } from "../export/layerSetup.ts";
import { PLAIN_LAYER, RAW_V1, RAW_V2 } from "../testing/premierePresets.ts";
import {
  EMPTY_LIBRARY,
  libraryText,
  readLibrary,
  rememberedVideoLayers,
  withLayerSetupRemembered,
  withoutPremierePreset,
  withPremierePresets,
} from "./videoLayerLibrary.ts";

const threeLayers: VideoLayer[] = [
  { ...PLAIN_LAYER, clipPremierePreset: RAW_V1 },
  { ...PLAIN_LAYER, clipPremierePreset: RAW_V2 },
  { ...PLAIN_LAYER, startsSwitchedOff: true },
];

describe("the library of PremierePresets and remembered LayerSetups (ADR-0033)", () => {
  test("what is written comes back as a later start of the app reads it", () => {
    const library = withLayerSetupRemembered(withPremierePresets(EMPTY_LIBRARY, [RAW_V1, RAW_V2]), "32:9", threeLayers);
    expect(readLibrary(libraryText(library))).toEqual(library);
  });

  test("text torn off mid-write reads as an empty library; one from a newer SmartTrim or damaged is refused", () => {
    expect(readLibrary("")).toEqual(EMPTY_LIBRARY);
    expect(readLibrary('{"smarttrimVideoLay')).toEqual(EMPTY_LIBRARY);
    const written = JSON.parse(libraryText(withPremierePresets(EMPTY_LIBRARY, [RAW_V1]))) as Record<string, unknown>;
    expect(() => readLibrary(JSON.stringify({ ...written, smarttrimVideoLayers: 99 }))).toThrow("newer SmartTrim");
    expect(() => readLibrary(JSON.stringify({ ...written, premierePresets: [{ name: "RAWCUT - V1" }] }))).toThrow(
      "damaged",
    );
  });

  test("adding a PremierePreset under a name already there replaces it where it stands", () => {
    const changed = { ...RAW_V1, transformScale: 50 };
    const library = withPremierePresets(withPremierePresets(EMPTY_LIBRARY, [RAW_V1, RAW_V2]), [changed]);
    expect(library.premierePresets).toEqual([changed, RAW_V2]);
  });

  test("deleting a PremierePreset takes it out of the list; a remembered LayerSetup keeps its own copy", () => {
    const library = withLayerSetupRemembered(withPremierePresets(EMPTY_LIBRARY, [RAW_V1, RAW_V2]), "32:9", threeLayers);
    const without = withoutPremierePreset(library, "RAWCUT - V2");
    expect(without.premierePresets).toEqual([RAW_V1]);
    expect(rememberedVideoLayers(without, "32:9")).toEqual(threeLayers);
  });

  test("a LayerSetup is remembered per aspect ratio, and V1 alone and plain is remembered as none", () => {
    const library = withLayerSetupRemembered(EMPTY_LIBRARY, "32:9", threeLayers);
    expect(rememberedVideoLayers(library, "32:9")).toEqual(threeLayers);
    expect(rememberedVideoLayers(library, "16:9")).toBeUndefined();
    expect(rememberedVideoLayers(withLayerSetupRemembered(library, "32:9", [PLAIN_LAYER]), "32:9")).toBeUndefined();
  });

  test("remembering or forgetting one aspect ratio leaves the others as they were", () => {
    const both = withLayerSetupRemembered(withLayerSetupRemembered(EMPTY_LIBRARY, "32:9", threeLayers), "43:18", [
      { ...PLAIN_LAYER, startsSwitchedOff: true },
    ]);
    const forgotten = withLayerSetupRemembered(both, "43:18", [PLAIN_LAYER]);
    expect(rememberedVideoLayers(forgotten, "32:9")).toEqual(threeLayers);
    expect(rememberedVideoLayers(forgotten, "43:18")).toBeUndefined();
  });

  test("a damaged remembered LayerSetup, or none at all, is refused and says which", () => {
    const written = JSON.parse(libraryText(EMPTY_LIBRARY)) as Record<string, unknown>;
    const damaged = { ...written, layerSetups: { "32:9": [{ startsSwitchedOff: "no" }] } };
    expect(() => readLibrary(JSON.stringify(damaged))).toThrow("32:9");
    const { layerSetups: _gone, ...withoutLayerSetups } = written;
    expect(() => readLibrary(JSON.stringify(withoutLayerSetups))).toThrow("remembered");
  });

  test.each(["raw-v1", "raw-v2", "raw-v3", "edit-v2-45"])(
    "%s as the reader gives it survives the library file to the last digit",
    (name) => {
      const text = readFileSync(new URL(`../../fixtures/premiere/video-layers/${name}.prfpset`, import.meta.url), "utf8");
      const [reading] = readPremierePresets(text);
      if (reading?.kind !== "read") throw new Error(`${name} did not read`);
      const library = withPremierePresets(EMPTY_LIBRARY, [reading.premierePreset]);
      expect(readLibrary(libraryText(library))).toEqual(library);
    },
  );
});
