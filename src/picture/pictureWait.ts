/** How much later than without a picture the owner allowed the sound to come (2026-09-14). */
export const PICTURE_ALLOWANCE_MS = 300;

/**
 * What an Excerpt read lost to frames being made beside it on the long Recording from the external drive, the slower of the owner's
 * two Recordings (ADR-0028): taken for the first press of a Tab, which has no read of its own to compare with.
 */
const READ_LOSS_ASSUMED_MS = 240;

/**
 * How long the sound may wait for the picture's first frames. `readMs` is how long this press's Excerpt took to read,
 * `fastestReadMs` the fastest read of the Tab before it, or null before there was one. What the read lost against the
 * fastest comes off the owner's allowance, so waiting and the slower read together stay within it.
 */
export function pictureWaitMs(readMs: number, fastestReadMs: number | null): number {
  const lost = fastestReadMs === null ? READ_LOSS_ASSUMED_MS : Math.max(readMs - fastestReadMs, 0);
  return Math.max(PICTURE_ALLOWANCE_MS - lost, 0);
}
