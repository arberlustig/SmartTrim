import { describe, expect, test } from "vitest";
import { pictureWaitMs } from "./pictureWait";

describe("how long the sound waits for the picture", () => {
  // The owner allowed the sound to come 0.3 s later than it would without a picture. Frames made beside the Excerpt read
  // slow that read down — 0.16 to 0.24 s on the owner's Recordings — so the wait has to shrink by what the read lost, or
  // the two together pass the 0.3 s (ADR-0028).
  test("the wait and what the read lost to the picture never add up to more than 0.3 s", () => {
    expect(pictureWaitMs(330, 320)).toBe(290);
    expect(pictureWaitMs(520, 320)).toBe(100);
    expect(pictureWaitMs(900, 480)).toBe(0);
    // A read faster than any before lost nothing.
    expect(pictureWaitMs(300, 320)).toBe(300);
  });

  // The first press in a Tab has no read to compare with. What a read lost on the long Recording from the external drive, the slower of
  // the owner's two Recordings, is taken, so the first start keeps to the 0.3 s as well.
  test("with no read to compare with, what the slower of the owner's Recordings lost is assumed", () => {
    expect(pictureWaitMs(700, null)).toBe(60);
  });
});
