import { describe, expect, test } from "vitest";
import { aspectRatioOf, sequenceFrameFor, type VideoLayer } from "./layerSetup.ts";
import type { PremierePreset } from "./premierePreset.ts";

const plainV1: VideoLayer = { clipPremierePreset: undefined, nestPremierePreset: undefined, startsSwitchedOff: false };
const rawV1: PremierePreset = {
  name: "RAWCUT - V1",
  motion: { position: { x: 1, y: 0.5 }, scale: 100, anchor: { x: 0.5, y: 0.5 } },
  crop: undefined,
  transformScale: 100,
  carried: ["Bewegung"],
  notCarried: [],
};
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
    ["V1 with only a clip PremierePreset", [{ ...plainV1, clipPremierePreset: rawV1 }]],
    ["V1 with only a Nest PremierePreset", [{ ...plainV1, nestPremierePreset: rawV1 }]],
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
