import { describe, expect, test } from "vitest";
import type { TimeRange } from "../cutting/planCuts";
import { bandsIn, keptShareByColumn } from "./cutShape";

/** Kept stretches the way the window gets them: seconds into the Recording, end exclusive. */
const kept = (...pairs: readonly (readonly [number, number])[]): TimeRange[] =>
  pairs.map(([startSeconds, endSeconds]) => ({ startSeconds, endSeconds }));

describe("the strip over the whole Recording", () => {
  test("shows the removed half empty and the kept half full", () => {
    expect([...keptShareByColumn(kept([50, 100]), 100, 4)]).toEqual([0, 0, 1, 1]);
  });

  // The point of a share rather than kept-or-removed: one column of the strip is minutes wide.
  test("a cut inside a single column dims it instead of emptying it", () => {
    expect([...keptShareByColumn(kept([0, 10]), 100, 4)]).toEqual([0.4, 0, 0, 0]);
    expect([...keptShareByColumn(kept([0, 25], [75, 100]), 100, 2)]).toEqual([0.5, 0.5]);
  });

  // The owner's real settings give 1681 to 2078 KeepSegments on a 2.5-hour Recording. Every one of them lands in a
  // column that is already part full, so the arithmetic has to stay inside 0..1 after thousands of additions.
  test("thousands of small kept stretches stay inside nothing-to-everything", () => {
    // 2000 kept stretches of 2 s with 2 s removed between them: exactly half of an 8000-second Recording.
    const many = Array.from({ length: 2000 }, (_unused, index) => ({
      startSeconds: index * 4,
      endSeconds: index * 4 + 2,
    }));

    const share = [...keptShareByColumn(many, 8000, 10)];

    expect(share).toHaveLength(10);
    for (const column of share) {
      expect(column).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThanOrEqual(1);
      expect(column).toBeCloseTo(0.5, 5);
    }
  });

  // A strip of no columns, or a Recording of no length, means the window asked before it had anything to draw.
  // Handing back an empty strip would show as "nothing is kept", which is a lie about the cut.
  test("refuses to describe a strip that cannot be drawn", () => {
    expect(() => keptShareByColumn(kept([0, 50]), 100, 0)).toThrow();
    expect(() => keptShareByColumn(kept([0, 50]), 0, 4)).toThrow();
  });
});

describe("the coloured bands behind the waveform", () => {
  test("a cut inside the window shows as kept, removed, kept", () => {
    expect(bandsIn(kept([0, 10], [14, 30]), 0, 30)).toEqual([
      { startSeconds: 0, endSeconds: 10, kept: true },
      { startSeconds: 10, endSeconds: 14, kept: false },
      { startSeconds: 14, endSeconds: 30, kept: true },
    ]);
  });

  test("a window sitting inside one kept stretch is kept all the way across", () => {
    expect(bandsIn(kept([0, 600]), 120, 240)).toEqual([{ startSeconds: 120, endSeconds: 240, kept: true }]);
  });

  test("a window sitting inside one removed stretch is removed all the way across", () => {
    expect(bandsIn(kept([0, 10], [500, 600]), 120, 240)).toEqual([
      { startSeconds: 120, endSeconds: 240, kept: false },
    ]);
  });

  // Zoomed in, the window usually starts and ends in the middle of a stretch. Drawing past its edge would spill
  // the colour over the neighbouring waveform.
  test("bands are cut off at the edges of the window, never drawn past them", () => {
    expect(bandsIn(kept([0, 100], [150, 400]), 50, 200)).toEqual([
      { startSeconds: 50, endSeconds: 100, kept: true },
      { startSeconds: 100, endSeconds: 150, kept: false },
      { startSeconds: 150, endSeconds: 200, kept: true },
    ]);
  });

  test("the bands cover the window with no gaps and no overlaps", () => {
    const bands = bandsIn(kept([0, 10], [14, 30], [44, 60]), 5, 50);

    expect(bands[0]?.startSeconds).toBe(5);
    expect(bands.at(-1)?.endSeconds).toBe(50);
    for (let index = 1; index < bands.length; index += 1) {
      expect(bands[index]?.startSeconds).toBe(bands[index - 1]?.endSeconds);
      // Two bands of the same colour in a row would mean a cut was invented or lost.
      expect(bands[index]?.kept).not.toBe(bands[index - 1]?.kept);
    }
  });

  test("refuses a window with no width", () => {
    expect(() => bandsIn(kept([0, 100]), 40, 40)).toThrow();
    expect(() => bandsIn(kept([0, 100]), 60, 40)).toThrow();
  });
});
