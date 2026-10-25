import { readFileSync } from "node:fs";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { describe, expect, test } from "vitest";
import { readPremierePresets, type PremierePreset } from "./premierePreset.ts";
import { basicMotionFor } from "./videoLayerMotion.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/premiere/video-layers/${name}`, import.meta.url), "utf8");

function premierePreset(name: string): PremierePreset {
  const [reading] = readPremierePresets(fixture(`${name}.prfpset`));
  if (reading?.kind !== "read") throw new Error(`${name} did not read`);
  return reading.premierePreset;
}

/** The Basic Motion centre Premiere wrote for one clipitem of a fixture. */
function writtenCenter(fixtureName: string, clipitemId: string): { horiz: number; vert: number } {
  const root = new DOMParser().parseFromString(fixture(fixtureName), "text/xml").documentElement;
  const clipitem = [...(root?.getElementsByTagName("clipitem") ?? [])].find(
    (element) => element.getAttribute("id") === clipitemId,
  );
  const center = [...(clipitem?.getElementsByTagName("parameter") ?? [])].find(
    (parameter) => parameter.getElementsByTagName("parameterid")[0]?.textContent === "center",
  ) as Element | undefined;
  const value = (axis: string) => Number(center?.getElementsByTagName(axis)[0]?.textContent);
  return { horiz: value("horiz"), vert: value("vert") };
}

const sequence1080 = { width: 1920, height: 1080 };
const recording32x9 = { width: 3840, height: 1080 };

describe("basicMotionFor", () => {
  test.each([
    ["raw-v1", "clipitem-23"],
    ["raw-v2", "clipitem-24"],
    ["raw-v3", "clipitem-25"],
  ])("%s puts the clip centre where Premiere's own export does (%s)", (name, clipitemId) => {
    const written = writtenCenter("3-presets-applied.xml", clipitemId);
    const { center } = basicMotionFor(premierePreset(name), sequence1080, recording32x9);
    expect(center.horiz).toBeCloseTo(written.horiz, 6);
    expect(center.vert).toBeCloseTo(written.vert, 6);
  });

  test("RAWCUT - V2's Transform 90 % shrinks the cam without moving its centre", () => {
    // Premiere's own export dropped the Transform and wrote scale 100.
    const motion = basicMotionFor(premierePreset("raw-v2"), sequence1080, recording32x9);
    expect(motion.scale).toBe(90);
    expect(motion.center.horiz).toBeCloseTo(-0.328125, 6);
  });

  test("EDIT - V2 45's corner anchor becomes a centre that covers the same bottom-left 864x486", () => {
    // A 45 % picture of the 1920x1080 Nest, its corner at the frame's bottom-left corner, spans x 0..864 and
    // y 594..1080. Its centre (432, 837) lies 528 left of and 297 below the middle of the frame: -528/1920 and
    // 297/1080 in units of the Nest's frame.
    const motion = basicMotionFor(premierePreset("edit-v2-45"), sequence1080, sequence1080);
    expect(motion.scale).toBe(45);
    expect(motion.center.horiz).toBeCloseTo(-0.275, 6);
    expect(motion.center.vert).toBeCloseTo(0.275, 6);
  });

  test("a folded Transform shrinks the picture around the centre Motion gave it, not around Motion's anchor", () => {
    // Motion at 50 % with its anchor and position at the bottom-left corner puts a 960x540 picture at x 0..960,
    // y 540..1080, centre (480, 810). The Transform's 90 % shrinks it around that centre, which stays put:
    // (480 - 960) / 1920 = -0.25 and (810 - 540) / 1080 = 0.25, at 45 %.
    const cornered: PremierePreset = {
      name: "corner",
      motion: { position: { x: 0, y: 1 }, scale: 50, anchor: { x: 0, y: 1 } },
      crop: undefined,
      transformScale: 90,
      carried: ["Transformieren", "Bewegung"],
      notCarried: [],
    };
    const motion = basicMotionFor(cornered, sequence1080, sequence1080);
    expect(motion.scale).toBe(45);
    expect(motion.center.horiz).toBeCloseTo(-0.25, 9);
    expect(motion.center.vert).toBeCloseTo(0.25, 9);
  });

  test("a clip without PremierePreset sits centred at full size", () => {
    expect(basicMotionFor(undefined, sequence1080, recording32x9)).toEqual({ scale: 100, center: { horiz: 0, vert: 0 } });
  });

  test("the same PremierePreset frames a 5120x1440 Recording in its 2560x1440 sequence just as a 3840x1080 one", () => {
    const motion = basicMotionFor(premierePreset("raw-v1"), { width: 2560, height: 1440 }, { width: 5120, height: 1440 });
    expect(motion.center.horiz).toBeCloseTo(0.25, 6);
    expect(motion.center.vert).toBeCloseTo(0, 6);
  });
});
