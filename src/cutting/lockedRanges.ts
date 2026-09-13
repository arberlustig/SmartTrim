import type { TimeRange } from "./planCuts.ts";

/**
 * LockedRanges as one list in the order of the Recording: each range with its edges in order, and ranges that overlap
 * or touch joined into one (ADR-0023). Wherever held stretches come from — two presses in the window or a saved
 * project — they pass through here. The window lists each held stretch once, and two entries for one would leave it
 * held after one of them was removed; a range with its edges swapped would plan a KeepSegment that runs backwards.
 */
export function normalisedLockedRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const ordered = ranges
    .map(({ startSeconds, endSeconds }) => ({
      startSeconds: Math.min(startSeconds, endSeconds),
      endSeconds: Math.max(startSeconds, endSeconds),
    }))
    .sort((one, other) => one.startSeconds - other.startSeconds);
  const joined: TimeRange[] = [];
  for (const range of ordered) {
    const previous = joined.at(-1);
    if (previous && range.startSeconds <= previous.endSeconds) {
      previous.endSeconds = Math.max(previous.endSeconds, range.endSeconds);
    } else {
      joined.push(range);
    }
  }
  return joined;
}
