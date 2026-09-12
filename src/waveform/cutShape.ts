import type { TimeRange } from "../cutting/planCuts.ts";

/** One stretch of the zoom window, drawn either as kept or as removed. */
export interface CutBand extends TimeRange {
  kept: boolean;
}

/**
 * The kept and removed stretches across the window the user is looking at, in order and with no gaps between them.
 * Everything the window does not show is left out, and the bands at the edges are clipped to it, so the drawing
 * code never has to think about what lies outside.
 */
export function bandsIn(kept: readonly TimeRange[], fromSeconds: number, toSeconds: number): CutBand[] {
  if (!(toSeconds > fromSeconds)) throw new Error(`${fromSeconds}..${toSeconds} is not a window.`);

  const bands: CutBand[] = [];
  let at = fromSeconds;

  for (const range of kept) {
    if (range.endSeconds <= fromSeconds) continue;
    if (range.startSeconds >= toSeconds) break;
    const start = Math.max(range.startSeconds, fromSeconds);
    const end = Math.min(range.endSeconds, toSeconds);
    // Whatever lies between the last kept stretch and this one was removed.
    if (start > at) bands.push({ startSeconds: at, endSeconds: start, kept: false });
    bands.push({ startSeconds: start, endSeconds: end, kept: true });
    at = end;
  }

  if (at < toSeconds) bands.push({ startSeconds: at, endSeconds: toSeconds, kept: false });
  return bands;
}

/**
 * How much of each column of the overview strip survives the cut, 0 to 1. The strip spans the whole Recording, so
 * one column can be minutes wide and hold dozens of cuts: reporting the share rather than kept-or-removed is what
 * keeps it honest at that scale, and it is what the window draws as brightness.
 */
export function keptShareByColumn(
  kept: readonly TimeRange[],
  recordingSeconds: number,
  columns: number,
): number[] {
  // An empty strip would be drawn as "nothing survives the cut", which is a lie rather than a blank.
  if (!(columns > 0)) throw new Error(`A strip of ${columns} columns cannot be drawn.`);
  if (!(recordingSeconds > 0)) throw new Error(`A Recording of ${recordingSeconds} seconds has no strip.`);

  // Plain numbers, not a Float32Array: the strip is a few hundred columns wide and never crosses to another
  // process, so the narrower type would buy nothing and would round a half-covered column to 0.40000000596.
  const share = new Array<number>(columns).fill(0);
  const secondsPerColumn = recordingSeconds / columns;

  for (const range of kept) {
    const from = range.startSeconds / secondsPerColumn;
    const to = range.endSeconds / secondsPerColumn;
    for (let column = Math.floor(from); column < Math.ceil(to) && column < columns; column += 1) {
      // How much of this column the range covers, as a fraction of the column's width.
      const covered = Math.min(to, column + 1) - Math.max(from, column);
      if (covered > 0) share[column] = (share[column] as number) + covered;
    }
  }
  return share;
}
