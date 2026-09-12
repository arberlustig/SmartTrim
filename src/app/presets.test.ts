import { describe, expect, test } from "vitest";
import { newCutSession, PRESETS, setEventTailSeconds, setMarginSeconds, type Preset } from "./cutSession";
import { allPresets, ownPresetsText, presetFromSliders, readOwnPresets, withoutPreset, withPreset } from "./presets";

/** The sliders as the user had them when they pressed "Speichern unter …". */
const abend: Preset = {
  name: "Abend",
  thresholdDbfs: -38,
  marginSeconds: 0.08,
  eventLeadSeconds: 1,
  eventTailSeconds: 1.5,
  minimumDeadZoneSeconds: 0.4,
};

describe("saving own Presets", () => {
  test("keeps the settings under the name they were saved with", () => {
    expect(withPreset([], abend)).toEqual([abend]);
  });

  test("saving over a name the user already used replaces it, leaving no second Preset of that name", () => {
    const stricter: Preset = { ...abend, minimumDeadZoneSeconds: 0.9 };
    expect(withPreset([abend], stricter)).toEqual([stricter]);
  });

  test("saving over a name keeps its place in the list, so the dropdown does not reshuffle", () => {
    const morgen: Preset = { ...abend, name: "Morgen" };
    const louder: Preset = { ...abend, thresholdDbfs: -30 };
    expect(withPreset([abend, morgen], louder)).toEqual([louder, morgen]);
  });

  test("refuses a name one of the built-in Presets already carries, so Gaming stays what it was", () => {
    expect(() => withPreset([], { ...abend, name: "Gaming" })).toThrow(/Gaming/);
  });

  test("refuses an empty name, which no dropdown could show", () => {
    expect(() => withPreset([], { ...abend, name: "   " })).toThrow();
  });
});

describe("saving what the sliders currently say", () => {
  test("takes the five settings off the sliders under the given name", () => {
    const session = setEventTailSeconds(setMarginSeconds(newCutSession(), 0.42), 3);

    expect(presetFromSliders(session, "Abend")).toEqual({
      name: "Abend",
      thresholdDbfs: session.thresholdDbfs,
      marginSeconds: 0.42,
      eventLeadSeconds: session.eventLeadSeconds,
      // Saved even while the window hides this slider, so a Preset is the same five settings whatever is on screen.
      eventTailSeconds: 3,
      minimumDeadZoneSeconds: session.minimumDeadZoneSeconds,
    });
  });

  test("refuses a built-in name and a blank one, before anything is written", () => {
    expect(() => presetFromSliders(newCutSession(), "Podcast")).toThrow(/Podcast/);
    expect(() => presetFromSliders(newCutSession(), " ")).toThrow();
  });
});

describe("the saved file", () => {
  /** Written by hand, not by the code under test: the format has to stay readable, not merely round trip. */
  const handWritten = `{
 "smarttrimPresets": 1,
 "presets": [
  {
   "name": "Abend",
   "thresholdDbfs": -38,
   "marginSeconds": 0.08,
   "eventLeadSeconds": 1,
   "eventTailSeconds": 1.5,
   "minimumDeadZoneSeconds": 0.4
  }
 ]
}`;

  test("reads the Presets a file holds", () => {
    expect(readOwnPresets(handWritten)).toEqual([abend]);
  });

  test("writes what it reads: saved Presets come back unchanged", () => {
    const morgen: Preset = { ...abend, name: "Morgen", thresholdDbfs: -52 };
    expect(readOwnPresets(ownPresetsText([abend, morgen]))).toEqual([abend, morgen]);
  });

  test("says which format it is, so a later SmartTrim can tell", () => {
    expect(JSON.parse(ownPresetsText([abend]))["smarttrimPresets"]).toBe(1);
  });

  // A file cut off mid-write holds nothing worth rescuing, so the user gets the built-in Presets and can carry on.
  test("reads a file torn off mid-write as no own Presets at all", () => {
    expect(readOwnPresets(`{ "smarttrimPresets": 1, "presets": [ { "name": "Ab`)).toEqual([]);
  });

  test("reads a file that is not a preset file at all as no own Presets at all", () => {
    expect(readOwnPresets(`{ "smarttrim": 2, "recording": {} }`)).toEqual([]);
    expect(readOwnPresets("")).toEqual([]);
  });

  // Here there is something to lose, so it is refused rather than emptied: saving over it would destroy Presets a
  // newer SmartTrim wrote.
  test("refuses a file a newer SmartTrim saved", () => {
    const newer = ownPresetsText([abend]).replace(`"smarttrimPresets": 1`, `"smarttrimPresets": 2`);
    expect(() => readOwnPresets(newer)).toThrow(/neuere/i);
  });

  test("refuses a Preset whose settings are not numbers", () => {
    const broken = ownPresetsText([abend]).replace("-38", `"leise"`);
    expect(() => readOwnPresets(broken)).toThrow(/Abend/);
  });

  test("refuses a Preset with no name, which the dropdown could not show", () => {
    const nameless = ownPresetsText([abend]).replace(`"Abend"`, `""`);
    expect(() => readOwnPresets(nameless)).toThrow();
  });
});

describe("the list the dropdown shows", () => {
  test("puts the built-in Presets first and the user's own underneath, in the order they were saved", () => {
    const morgen: Preset = { ...abend, name: "Morgen" };
    expect(allPresets([abend, morgen]).map((preset) => preset.name)).toEqual([
      "Gaming",
      "Reaction",
      "Podcast",
      "Abend",
      "Morgen",
    ]);
  });

  test("is the built-in Presets alone when the user has saved none", () => {
    expect(allPresets([])).toEqual(PRESETS);
  });
});

describe("deleting own Presets", () => {
  const morgen: Preset = { ...abend, name: "Morgen" };

  test("removes the named one and leaves the others alone", () => {
    expect(withoutPreset([abend, morgen], "Abend")).toEqual([morgen]);
  });

  test("refuses a built-in Preset, which the user is never offered a delete for", () => {
    expect(() => withoutPreset([abend], "Gaming")).toThrow(/Gaming/);
  });

  test("refuses a name that is not there, rather than quietly doing nothing", () => {
    expect(() => withoutPreset([abend], "Nachmittag")).toThrow(/Nachmittag/);
  });
});
