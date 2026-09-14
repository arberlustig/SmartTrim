import { describe, expect, test } from "vitest";
import { LANGUAGES, TEXTS, decimalsIn, languageOf } from "./texts";

/** Every leaf of a texts object: a string, or a function called with plausible arguments. */
function leaves(value: unknown, path: string, into: [string, unknown][]): void {
  if (typeof value === "function") {
    into.push([path, (value as (...args: unknown[]) => unknown)(2, 4, 5)]);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) leaves(inner, `${path}.${key}`, into);
  } else {
    into.push([path, value]);
  }
}

describe("the texts", () => {
  test("both languages say something for every sentence", () => {
    for (const language of LANGUAGES) {
      const found: [string, unknown][] = [];
      leaves(TEXTS[language], language, found);
      const empty = found.filter(([, said]) => typeof said !== "string" || said.trim() === "");
      expect(empty, `${language}: ${empty.map(([path]) => path).join(", ")}`).toEqual([]);
    }
  });

  test("the two languages have the same sentences", () => {
    const paths = (language: "de" | "en") => {
      const found: [string, unknown][] = [];
      leaves(TEXTS[language], "", found);
      return found.map(([path]) => path).sort();
    };
    expect(paths("en")).toEqual(paths("de"));
  });

  test("lengths and numbers follow the language", () => {
    expect(TEXTS.de.duration(12.34)).toBe("12,3 Sek");
    expect(TEXTS.en.duration(12.34)).toBe("12.3 s");
    expect(TEXTS.de.duration(25 * 60)).toBe("25 Min");
    expect(TEXTS.en.duration(25 * 60)).toBe("25 min");
    expect(TEXTS.de.duration(2 * 3600 + 32 * 60)).toBe("2 Std 32 Min");
    expect(TEXTS.en.duration(2 * 3600 + 32 * 60)).toBe("2 h 32 min");
    expect(decimalsIn(TEXTS.de)(0.05, 2)).toBe("0,05");
    expect(decimalsIn(TEXTS.en)(0.05, 2)).toBe("0.05");
  });

  test("sentences with a count read right for one and for many", () => {
    expect(TEXTS.de.filesNotOpened(1)).toBe("Eine Datei ließ sich nicht öffnen");
    expect(TEXTS.de.filesNotOpened(3)).toBe("3 Dateien ließen sich nicht öffnen");
    expect(TEXTS.en.showEmpty(1, 0)).toBe("Show 1 empty track (does not go to Premiere)");
    expect(TEXTS.en.showEmpty(2, 1)).toBe("Show 2 empty tracks (1 of them goes to Premiere)");
    expect(TEXTS.de.cutAllHeading({ cut: 8, alreadyCut: 0, skipped: 2, failed: 0 })).toBe("Alle schneiden: 8 geschnitten, 2 übersprungen");
    expect(TEXTS.en.cutAllHeading({ cut: 0, alreadyCut: 0, skipped: 0, failed: 0 })).toBe("Cut all: nothing to do");
  });
});

describe("languageOf: which language the window speaks", () => {
  test("a chosen language wins over the system's", () => {
    expect(languageOf("en", "de-DE")).toBe("en");
    expect(languageOf("de", "en-US")).toBe("de");
  });

  test("without a choice, German on a German system and English anywhere else", () => {
    expect(languageOf(null, "de-AT")).toBe("de");
    expect(languageOf(undefined, "de")).toBe("de");
    expect(languageOf(null, "en-GB")).toBe("en");
    expect(languageOf(null, "fr-FR")).toBe("en");
    expect(languageOf("klingon", "de-DE")).toBe("de");
  });
});
