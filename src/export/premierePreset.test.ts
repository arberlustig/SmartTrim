import { readFileSync } from "node:fs";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { describe, expect, test } from "vitest";
import { readPremierePresets, type PremierePreset } from "./premierePreset.ts";

// The owner's four PremierePresets, as Premiere saved them (ADR-0033).
const premierePresetFile = (name: string) =>
  readFileSync(new URL(`../../fixtures/premiere/video-layers/${name}.prfpset`, import.meta.url), "utf8");

/**
 * The file with one parameter's start value replaced. The parameter is found as the reader finds it, by the effect's
 * MatchName and the parameter's ParameterID: its Name is in Premiere's language and not unique.
 */
function withParameter(text: string, matchName: string, parameterId: number, value: string): string {
  const document = new DOMParser().parseFromString(text, "text/xml");
  const byId = new Map<string, Element>();
  for (const element of [...document.getElementsByTagName("*")]) {
    const id = element.getAttribute("ObjectID");
    if (id) byId.set(id, element);
  }
  const textOf = (element: Element, name: string) => element.getElementsByTagName(name)[0]?.textContent;
  const component = [...document.getElementsByTagName("MatchName")]
    .find((element) => element.textContent === matchName)?.parentNode as Element | undefined;
  const parameter = [...(component?.getElementsByTagName("Param") ?? [])]
    .map((param) => byId.get(param.getAttribute("ObjectRef") ?? ""))
    .find((element) => element && textOf(element, "ParameterID") === String(parameterId));
  const startKeyframe = parameter?.getElementsByTagName("StartKeyframe")[0];
  if (!startKeyframe) throw new Error(`no parameter ${parameterId} of ${matchName}`);
  const fields = (startKeyframe.textContent ?? "").split(",");
  fields[1] = value;
  startKeyframe.textContent = fields.join(",");
  return new XMLSerializer().serializeToString(document);
}

function onlyPremierePreset(text: string): PremierePreset {
  const readings = readPremierePresets(text);
  expect(readings).toHaveLength(1);
  const [reading] = readings;
  if (reading?.kind !== "read") throw new Error(`expected a PremierePreset, got ${JSON.stringify(reading)}`);
  return reading.premierePreset;
}

const MOTION = "AE.ADBE Motion";
const CROP = "AE.ADBE AECrop";
const TRANSFORM = "AE.ADBE Geometry2";

describe("readPremierePresets", () => {
  test("RAWCUT - V1 is a Motion that moves the left half of the picture into the frame", () => {
    const premierePreset = onlyPremierePreset(premierePresetFile("raw-v1"));
    expect(premierePreset.name).toBe("RAWCUT - V1");
    // Premiere stores what was dragged by hand: 0.99999999666 and 0.50000005570.
    expect(premierePreset.motion.position.x).toBeCloseTo(1, 6);
    expect(premierePreset.motion.position.y).toBeCloseTo(0.5, 6);
    expect(premierePreset.motion.scale).toBe(100);
    expect(premierePreset.motion.anchor).toEqual({ x: 0.5, y: 0.5 });
    expect(premierePreset.crop).toBeUndefined();
    expect(premierePreset.transformScale).toBe(100);
    expect(premierePreset.notCarried).toEqual([]);
    expect(premierePreset.carried).toEqual(["Bewegung"]);
  });

  test("RAWCUT - V2 carries its Crop and Transform's 90 % and names the rough edges and shadows it leaves behind", () => {
    const premierePreset = onlyPremierePreset(premierePresetFile("raw-v2"));
    expect(premierePreset.name).toBe("RAWCUT - V2"); // saved as "RAWCUT - V2 " with a trailing space
    expect(premierePreset.crop).toEqual({ left: 61, top: 0, right: 11, bottom: 0 });
    expect(premierePreset.transformScale).toBe(90);
    expect(premierePreset.motion.position.x).toBeCloseTo(-0.15625, 6);
    expect(premierePreset.motion.position.y).toBeCloseTo(0.5185185, 6);
    expect(premierePreset.notCarried).toEqual([
      { effect: "Kanten aufrauen" },
      { effect: "Schlagschatten" },
      { effect: "Schlagschatten" },
    ]);
    expect(premierePreset.carried).toEqual(["Zuschneiden", "Transformieren", "Bewegung"]);
  });

  test("EDIT - V2 45 shrinks to 45 % around an anchor moved to the bottom-left corner", () => {
    // Its Motion stores a stale Scale Width of 100 beside Uniform Scale on: Premiere ignores it, and so does the reader.
    const premierePreset = onlyPremierePreset(premierePresetFile("edit-v2-45"));
    expect(premierePreset.name).toBe("EDIT - V2 45");
    expect(premierePreset.motion.scale).toBe(45);
    expect(premierePreset.motion.anchor.x).toBeCloseTo(0, 6);
    expect(premierePreset.motion.anchor.y).toBeCloseTo(1, 6);
    expect(premierePreset.motion.position.x).toBeCloseTo(0, 6);
    expect(premierePreset.motion.position.y).toBeCloseTo(1, 6);
    expect(premierePreset.crop).toBeUndefined();
    expect(premierePreset.transformScale).toBe(100);
    expect(premierePreset.notCarried).toEqual([]);
  });

  test("a PremierePreset whose Position changes over time is refused: its keyframes mean nothing on a piece", () => {
    const animated = premierePresetFile("raw-v1").replace(
      "<IsTimeVarying>false</IsTimeVarying>",
      "<IsTimeVarying>true</IsTimeVarying>",
    );
    expect(readPremierePresets(animated)).toEqual([{ kind: "refused", name: "RAWCUT - V1", why: "animated" }]);
  });

  test("a rotated Motion is refused until a Premiere export shows how rotation is written", () => {
    const rotated = withParameter(premierePresetFile("raw-v1"), MOTION, 5, "15.");
    expect(readPremierePresets(rotated)).toEqual([{ kind: "refused", name: "RAWCUT - V1", why: "rotated" }]);
  });

  test("a Motion that stretches one way is refused, since FCP's Basic Motion has a single scale", () => {
    const unticked = withParameter(premierePresetFile("raw-v1"), MOTION, 4, "false");
    expect(onlyPremierePreset(unticked).motion.scale).toBe(100); // Scale Width is 100 as well: nothing stretches
    const stretched = withParameter(unticked, MOTION, 3, "80.");
    expect(readPremierePresets(stretched)).toEqual([
      { kind: "refused", name: "RAWCUT - V1", why: "nonUniformScale" },
    ]);
  });

  test("a Transform that does more than scale is named instead of folded into Motion", () => {
    const skewed = withParameter(premierePresetFile("raw-v2"), TRANSFORM, 5, "10.");
    const premierePreset = onlyPremierePreset(skewed);
    expect(premierePreset.transformScale).toBe(100);
    expect(premierePreset.notCarried).toEqual(
      [
        { effect: "Kanten aufrauen" },
        { effect: "Schlagschatten" },
        { effect: "Schlagschatten" },
        { effect: "Transformieren" },
      ],
    );
  });

  test("a PremierePreset without a single video effect is refused", () => {
    const audioOnly = premierePresetFile("raw-v1").replaceAll("VideoFilterComponent", "AudioFilterComponent");
    expect(readPremierePresets(audioOnly)).toEqual([{ kind: "refused", name: "RAWCUT - V1", why: "noVideoEffect" }]);
  });

  test("text that is not a Premiere preset file reads as no PremierePreset", () => {
    expect(readPremierePresets("")).toEqual([]);
    expect(readPremierePresets("RAWCUT - V1")).toEqual([]);
    const sequence = readFileSync(
      new URL("../../fixtures/premiere/video-layers/4-nested.xml", import.meta.url),
      "utf8",
    );
    expect(readPremierePresets(sequence)).toEqual([]);
  });

  test("a Crop below another effect is named instead of carried, so re-applying the PremierePreset crops only once", () => {
    // Transform first, Crop last: the imported Crop would run before the re-applied Transform, the preset's own after.
    const cropLast = premierePresetFile("raw-v2")
      .replace('<FilterPreset Index="0" ObjectRef="7"/>', '<FilterPreset Index="0" ObjectRef="48"/>')
      .replace('<FilterPreset Index="4" ObjectRef="48"/>', '<FilterPreset Index="4" ObjectRef="7"/>');
    const premierePreset = onlyPremierePreset(cropLast);
    expect(premierePreset.crop).toBeUndefined();
    expect(premierePreset.transformScale).toBe(90);
    expect(premierePreset.notCarried).toEqual(
      [{ effect: "Kanten aufrauen" }, { effect: "Schlagschatten" }, { effect: "Schlagschatten" }, { effect: "Zuschneiden" }],
    );
    expect(premierePreset.carried).toEqual(["Transformieren", "Bewegung"]);
  });

  test("a Transform with a negative scale turns the picture over and is named, not folded", () => {
    const flipped = onlyPremierePreset(withParameter(premierePresetFile("raw-v2"), TRANSFORM, 3, "-90."));
    expect(flipped.transformScale).toBe(100);
    expect(flipped.notCarried).toContainEqual({ effect: "Transformieren" });
  });

  test("an audio effect saved into the PremierePreset is left alone: neither named nor checked for animation", () => {
    // Roughen Edges stands in for an audio effect such as Volume, whose stopwatch Premiere switches on by itself.
    const withAudio = premierePresetFile("raw-v2")
      .replace(
        /<VideoFilterComponent ObjectID="16"([\s\S]*?)<\/VideoFilterComponent>/,
        '<AudioFilterComponent ObjectID="16"$1</AudioFilterComponent>',
      )
      // its first parameter, "Kantenart"
      .replace(/(ObjectID="17"[\s\S]*?<IsTimeVarying>)false/, "$1true");
    expect(onlyPremierePreset(withAudio).notCarried).toEqual([{ effect: "Schlagschatten" }, { effect: "Schlagschatten" }]);
  });

  test("a file an editor saved with a byte-order mark still reads", () => {
    expect(onlyPremierePreset(`﻿${premierePresetFile("raw-v1")}`).name).toBe("RAWCUT - V1");
  });

  test("keyframes alone, without the time-varying flag, are animation too", () => {
    const keyframed = premierePresetFile("raw-v1").replace(
      "<Keyframes></Keyframes>",
      "<Keyframes>0,0.5:0.5,0,0,0,0,0,0;1270080000000,1:0.5,0,0,0,0,0,0</Keyframes>",
    );
    expect(readPremierePresets(keyframed)).toEqual([{ kind: "refused", name: "RAWCUT - V1", why: "animated" }]);
  });

  test("Motion's anti-flicker and hidden crop are named by what they are, not by the file's labels", () => {
    const flickerless = withParameter(premierePresetFile("raw-v1"), MOTION, 7, "0.5");
    const cropped = withParameter(flickerless, MOTION, 8, "10.");
    expect(onlyPremierePreset(cropped).notCarried).toEqual([
      { effect: "Bewegung", parameter: "motionAntiFlicker" },
      { effect: "Bewegung", parameter: "motionCrop" },
    ]);
  });

  test("Crop's Zoom tick and soft edge are named, though the file leaves Zoom without a label", () => {
    const zoomed = withParameter(premierePresetFile("raw-v2"), CROP, 5, "true");
    const softened = withParameter(zoomed, CROP, 6, "20");
    expect(onlyPremierePreset(softened).notCarried.slice(0, 2)).toEqual([
      { effect: "Zuschneiden", parameter: "cropZoom" },
      { effect: "Zuschneiden", parameter: "cropEdgeFeather" },
    ]);
  });

  test("Crop's four sides land where Premiere has them: 1 left, 2 top, 3 right, 4 bottom", () => {
    const topped = withParameter(premierePresetFile("raw-v2"), CROP, 2, "5.");
    const bottomed = withParameter(topped, CROP, 4, "7.");
    expect(onlyPremierePreset(bottomed).crop).toEqual({ left: 61, top: 5, right: 11, bottom: 7 });
  });

  test("a second Crop is named, and the first one's values are kept", () => {
    const twice = premierePresetFile("raw-v2").replace(
      '<FilterPreset Index="5" ObjectRef="62"/>',
      '<FilterPreset Index="5" ObjectRef="62"/><FilterPreset Index="6" ObjectRef="7"/>',
    );
    const premierePreset = onlyPremierePreset(twice);
    expect(premierePreset.crop).toEqual({ left: 61, top: 0, right: 11, bottom: 0 });
    expect(premierePreset.notCarried.at(-1)).toEqual({ effect: "Zuschneiden" });
  });

  test("two pure Transforms fold into one scale: 90 % of 90 % is 81 %", () => {
    const twice = premierePresetFile("raw-v2").replace(
      '<FilterPreset Index="5" ObjectRef="62"/>',
      '<FilterPreset Index="5" ObjectRef="62"/><FilterPreset Index="6" ObjectRef="48"/>',
    );
    expect(onlyPremierePreset(twice).transformScale).toBeCloseTo(81, 9);
  });

  test.each([
    ["its anchor is moved", 1, "0.4:0.5"],
    ["its position is moved", 2, "0.5:0.6"],
    ["it rotates", 7, "10."],
    ["it fades", 8, "50."],
    ["it stretches one way", 11, "false"], // Scale Width stays 100 beside Scale Height 90
  ])("a Transform is named, not folded, when %s", (_, parameterId, value) => {
    const premierePreset = onlyPremierePreset(withParameter(premierePresetFile("raw-v2"), TRANSFORM, parameterId, value));
    expect(premierePreset.transformScale).toBe(100);
    expect(premierePreset.notCarried).toContainEqual({ effect: "Transformieren" });
  });

  test("a Transform without the Uniform Scale tick still folds when its height and width agree", () => {
    const unticked = withParameter(premierePresetFile("raw-v2"), TRANSFORM, 11, "false");
    expect(onlyPremierePreset(withParameter(unticked, TRANSFORM, 4, "90.")).transformScale).toBe(90);
  });

  test("a file holding several PremierePresets gives one reading each, refused ones included", () => {
    const shifted = premierePresetFile("edit-v2-45").replace(
      /(Object(?:ID|Ref)=")(\d+)"/g,
      (_, attribute: string, id: string) => `${attribute}${Number(id) + 1000}"`,
    );
    const body = shifted.slice(shifted.indexOf("<PremiereData"), shifted.indexOf("</PremiereData>"));
    const both = premierePresetFile("raw-v1").replace(
      "</PremiereData>",
      `${body.slice(body.indexOf(">") + 1)}</PremiereData>`,
    );
    expect(readPremierePresets(both).map((reading) => reading.kind === "read" && reading.premierePreset.name)).toEqual([
      "RAWCUT - V1",
      "EDIT - V2 45",
    ]);
    const rotatedFirst = withParameter(both, MOTION, 5, "15.");
    const outcomes = readPremierePresets(rotatedFirst).map((reading) => (reading.kind === "refused" ? reading.why : "read"));
    expect(outcomes).toEqual(["rotated", "read"]);
  });

  test.each([
    ["a Position without its second coordinate", MOTION, 1, "0.99999999666283479"],
    ["a Scale that is no number", MOTION, 2, "groß"],
  ])("a PremierePreset with %s is refused: what SmartTrim saves it must read back", (_, matchName, parameterId, value) => {
    const broken = withParameter(premierePresetFile("raw-v1"), matchName, parameterId, value);
    expect(readPremierePresets(broken)).toEqual([{ kind: "refused", name: "RAWCUT - V1", why: "brokenValue" }]);
  });
});
