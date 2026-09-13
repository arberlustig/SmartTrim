import { describe, expect, test } from "vitest";
import type { TimeRange } from "../cutting/planCuts";
import { playbackOf, recordingSecondsAt } from "./playback";
import type { Excerpt } from "./readExcerpt";

/** Kept stretches the way the window gets them: seconds into the Recording, end exclusive. */
const kept = (...pairs: readonly (readonly [number, number])[]): TimeRange[] =>
  pairs.map(([startSeconds, endSeconds]) => ({ startSeconds, endSeconds }));

/**
 * An Excerpt at 10 samples per second whose samples carry their own frame number, +n on the left Channel and -n on
 * the right, so which frames were played, and in what order, can be read straight off the result.
 */
function numberedExcerpt(fromSeconds: number, seconds: number): Excerpt {
  const sampleRate = 10;
  const samples = new Int16Array(seconds * sampleRate * 2);
  for (let frame = 0; frame < seconds * sampleRate; frame++) {
    samples[frame * 2] = frame;
    samples[frame * 2 + 1] = -frame;
  }
  return { fromSeconds, sampleRate, channelCount: 2, samples };
}

const leftChannel = (samples: Int16Array) => samples.filter((_sample, index) => index % 2 === 0);
const rightChannel = (samples: Int16Array) => samples.filter((_sample, index) => index % 2 === 1);

describe("listening to the cut", () => {
  // 3 s of Recording from 100 s. Kept: until 100.5 s, 101.2 to 101.8 s, from 102.5 s on — the first and the last
  // stretch reach past the Excerpt. Frames 0-4, 12-17 and 25-29 survive, and they meet at two Joins.
  test("skipping what is removed plays the kept frames back to back, with a Join wherever a removed stretch was", () => {
    const played = playbackOf(numberedExcerpt(100, 3), kept([99, 100.5], [101.2, 101.8], [102.5, 110]), true);

    expect([...leftChannel(played.samples)]).toEqual([0, 1, 2, 3, 4, 12, 13, 14, 15, 16, 17, 25, 26, 27, 28, 29]);
    expect([...rightChannel(played.samples)]).toEqual([0, -1, -2, -3, -4, -12, -13, -14, -15, -16, -17, -25, -26, -27, -28, -29]);
    expect(played.joins).toEqual([
      { playedSeconds: 0.5, removedFromSeconds: 100.5, removedToSeconds: 101.2 },
      { playedSeconds: 1.1, removedFromSeconds: 101.8, removedToSeconds: 102.5 },
    ]);
  });

  // The Playhead is drawn over the waveform, which shows the Recording, while the sound runs on a clock of its own
  // that knows nothing of what was skipped.
  test("the Playhead points at the moment of the Recording being heard, jumping ahead at every Join", () => {
    const played = playbackOf(numberedExcerpt(100, 3), kept([99, 100.5], [101.2, 101.8], [102.5, 110]), true);

    const heard = [
      [0, 100],
      [0.25, 100.25],
      [0.5, 101.2],
      [1.05, 101.75],
      [1.1, 102.5],
      [1.6, 103],
      [5, 103],
    ] as const;
    for (const [playedSeconds, recordingSeconds] of heard) {
      expect(recordingSecondsAt(played, playedSeconds), `after ${playedSeconds} s played`).toBeCloseTo(recordingSeconds, 9);
    }
  });

  // With the switch off — and before anything is cut, when there is nothing to skip — the user hears the Recording
  // as it is, removed stretches included, so they can hear what the cut would take away.
  test("not skipping plays the whole Excerpt as it is, with no Joins, and the Playhead runs with the Recording", () => {
    const excerpt = numberedExcerpt(100, 3);

    const played = playbackOf(excerpt, kept([99, 100.5], [101.2, 101.8], [102.5, 110]), false);

    expect([...played.samples]).toEqual([...excerpt.samples]);
    expect(played.joins).toEqual([]);
    expect(recordingSecondsAt(played, 0)).toBeCloseTo(100, 9);
    expect(recordingSecondsAt(played, 0.8)).toBeCloseTo(100.8, 9);
    expect(recordingSecondsAt(played, 3)).toBeCloseTo(103, 9);
  });

  // Zoomed into a long removed stretch there is nothing left to hear. Playing nothing would sound like a Recording
  // nobody made a sound on, and the Playhead would have no moment to point at.
  test("refuses to skip through an Excerpt the cut keeps nothing of", () => {
    expect(() => playbackOf(numberedExcerpt(100, 3), kept([0, 10], [500, 600]), true)).toThrow(/nothing/);
    // A kept stretch that only touches the Excerpt's edge keeps no frame of it either.
    expect(() => playbackOf(numberedExcerpt(100, 3), kept([90, 100], [103, 110]), true)).toThrow(/nothing/);
  });
});
