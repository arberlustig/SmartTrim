import { describe, expect, test } from "vitest";
import { aspectRatioOf, sequenceFrameFor, videoLayersFrom, type VideoLayer } from "./layerSetup.ts";
import { RAW_V1, RAW_V2 } from "../testing/premierePresets.ts";

const plainV1: VideoLayer = { clipPremierePreset: undefined, nestPremierePreset: undefined, startsSwitchedOff: false };
const threeLayers: VideoLayer[] = [plainV1, plainV1, { ...plainV1, startsSwitchedOff: true }];

describe("sequenceFrameFor", () => {
  test.each([
    [3840, 1080, 1920, 1080],
    [5120, 1440, 2560, 1440],
  ])("a %ix%i Recording with VideoLayers gets a 16:9 sequence of its height, %ix%i", (width, height, toWidth, toHeight) => {
    expect(sequenceFrameFor({ width, height }, threeLayers)).toEqual({ width: toWidth, height: toHeight });
  });

  test.each([
    ["V1 alone, without PremierePreset or tick", [plainV1]],
    ["no VideoLayer at all", []],
  ])("%s is no LayerSetup: the sequence keeps the Recording's frame", (_, videoLayers) => {
    expect(sequenceFrameFor({ width: 3840, height: 1080 }, videoLayers)).toEqual({ width: 3840, height: 1080 });
  });

  test.each([
    ["V1 with only its tick", [{ ...plainV1, startsSwitchedOff: true }]],
    ["V1 with only a clip PremierePreset", [{ ...plainV1, clipPremierePreset: RAW_V1 }]],
    ["V1 with only a Nest PremierePreset", [{ ...plainV1, nestPremierePreset: RAW_V1 }]],
    ["two plain VideoLayers", [plainV1, plainV1]],
  ])("%s is a LayerSetup too", (_, videoLayers) => {
    expect(sequenceFrameFor({ width: 3840, height: 1080 }, videoLayers)).toEqual({ width: 1920, height: 1080 });
  });

  test.each([
    [1920, 1080],
    [1920, 1200],
    [1080, 1920],
  ])("a %ix%i Recording, no wider than 16:9, keeps its frame under VideoLayers", (width, height) => {
    expect(sequenceFrameFor({ width, height }, threeLayers)).toEqual({ width, height });
  });

  test.each([
    [3440, 1440, 2560],
    [2560, 1080, 1920],
    [2520, 1050, 1866], // 1866.67 rounds to the nearest even width
    [3840, 1200, 2134], // 2133.33 too: rounding down would give 2132
  ])("a %ix%i Recording becomes %i wide", (width, height, toWidth) => {
    expect(sequenceFrameFor({ width, height }, threeLayers)).toEqual({ width: toWidth, height });
  });
});

describe("aspectRatioOf", () => {
  test.each([
    [3840, 1080, "32:9"],
    [5120, 1440, "32:9"],
    [1920, 1080, "16:9"],
    [2560, 1080, "64:27"], // "21:9" on the box, a different ratio from 3440x1440's 43:18
    [3440, 1440, "43:18"],
  ])("%ix%i is %s, the key a LayerSetup is remembered under", (width, height, ratio) => {
    expect(aspectRatioOf({ width, height })).toBe(ratio);
  });
});

describe("videoLayersFrom", () => {
  // VideoLayers as a file holds them: written out and read back as JSON, which leaves out what is undefined.
  const saved = () =>
    JSON.parse(
      JSON.stringify([
        { ...plainV1, clipPremierePreset: RAW_V2, nestPremierePreset: RAW_V2 },
        { ...plainV1, startsSwitchedOff: true },
      ]),
    ) as Record<string, any>[];

  test("reads VideoLayers back as they were saved; a place that held no PremierePreset holds none", () => {
    expect(videoLayersFrom(saved())).toEqual([
      { clipPremierePreset: RAW_V2, nestPremierePreset: RAW_V2, startsSwitchedOff: false },
      { clipPremierePreset: undefined, nestPremierePreset: undefined, startsSwitchedOff: true },
    ]);
  });

  test("reads a PremierePreset without a Crop", () => {
    expect(videoLayersFrom(JSON.parse(JSON.stringify([{ ...plainV1, clipPremierePreset: RAW_V1 }])))).not.toBeNull();
  });

  test.each<[string, (layers: Record<string, any>[]) => unknown]>([
    ["no VideoLayer at all, not even V1", () => []],
    ["a tick that is missing", (layers) => (delete layers[1]!["startsSwitchedOff"], layers)],
    ["a tick that is no true or false", (layers) => ((layers[1]!["startsSwitchedOff"] = "yes"), layers)],
    ["a PremierePreset whose name is a number", (layers) => ((layers[0]!["clipPremierePreset"].name = 7), layers)],
    ["a Nest PremierePreset whose scale is text", (layers) => ((layers[0]!["nestPremierePreset"].transformScale = "90"), layers)],
    ["a Motion without its anchor", (layers) => (delete layers[0]!["clipPremierePreset"].motion.anchor, layers)],
    ["a Crop missing a side", (layers) => (delete layers[0]!["clipPremierePreset"].crop.left, layers)],
    ["a carried effect that is no name", (layers) => ((layers[0]!["clipPremierePreset"].carried = [1]), layers)],
    ["an effect left behind that is no name", (layers) => ((layers[0]!["clipPremierePreset"].notCarried = [{ effect: 1 }]), layers)],
    [
      "a parameter left behind that the window has no words for",
      (layers) => ((layers[0]!["clipPremierePreset"].notCarried = [{ effect: "Bewegung", parameter: "anything" }]), layers),
    ],
  ])("refuses saved VideoLayers with %s", (_, breakThem) => {
    expect(videoLayersFrom(breakThem(saved()))).toBeNull();
  });
});
