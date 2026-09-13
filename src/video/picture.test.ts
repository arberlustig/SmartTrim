import { describe, expect, test } from "vitest";
import type { TimeRange } from "../cutting/planCuts";
import { playbackOf } from "../playback/playback";
import type { Excerpt } from "../playback/readExcerpt";
import { pictureFor } from "./picture";

/** Kept stretches the way the window gets them: seconds into the Recording, end exclusive. */
const kept = (...pairs: readonly (readonly [number, number])[]): TimeRange[] =>
  pairs.map(([startSeconds, endSeconds]) => ({ startSeconds, endSeconds }));

/** Silent stereo at 10 samples per second from `fromSeconds`: only where the pieces and Joins fall matters here. */
function excerpt(fromSeconds: number, seconds: number): Excerpt {
  return { fromSeconds, sampleRate: 10, channelCount: 2, samples: new Int16Array(seconds * 10 * 2) };
}

/** A picture showing `seconds` of the Recording, done seeking. */
const showing = (seconds: number) => ({ seconds, seeking: false });

// 3 s of Recording from 100 s, skipping what is removed. Kept: until 100.5 s, 101.2 to 101.8 s, from 102.5 s on — so
// the sound plays 100–100.5, then 101.2–101.8 from 0.5 s on, then 102.5–103 from 1.1 s on.
const skipping = playbackOf(excerpt(100, 3), kept([99, 100.5], [101.2, 101.8], [102.5, 110]), true);

// The picture above the SourceTracks follows the sound, which runs on the audio clock (ADR-0027).
describe("the picture", () => {
  test("shows the moment being heard, runs on while it is within a tenth of a second, and has the next Join ready", () => {
    const close = pictureFor(skipping, 0.2, showing(100.25));
    const offBy150ms = pictureFor(skipping, 0.2, showing(100.35));

    expect(close.wantedSeconds).toBeCloseTo(100.2, 9);
    expect([close.seek, offBy150ms.seek]).toEqual([false, true]);
    expect(close.nextJoin).toEqual({ playedSeconds: 0.5, removedFromSeconds: 100.5, removedToSeconds: 101.2 });
  });

  test("at a Join it jumps to where the sound went on, and the Join after that is the one to have ready", () => {
    // The sound reached the first Join 20 ms ago; a picture that ran on through it still shows the removed stretch.
    const justPast = pictureFor(skipping, 0.52, showing(100.52));
    // Past the last Join there is nothing more to make ready.
    const lastPiece = pictureFor(skipping, 1.2, showing(102.6));

    expect(justPast.wantedSeconds).toBeCloseTo(101.22, 9);
    expect(justPast.seek).toBe(true);
    expect(justPast.nextJoin).toEqual({ playedSeconds: 1.1, removedFromSeconds: 101.8, removedToSeconds: 102.5 });
    expect([lastPiece.seek, lastPiece.nextJoin]).toEqual([false, null]);
  });

  // The owner's picture stuttered from the first cut on. A picture that took over before it was ready reports the moment
  // it is seeking to while the sound runs on; told to seek again every frame, the seek started over and never ended, and
  // the abandoned HEVC seeks piled up on the graphics chip (ADR-0027).
  test("a picture still seeking is not told to seek again, however far behind the sound it looks", () => {
    // 0.3 s behind: the picture took over at the first Join at 101.2 s, and the sound is already at 101.5 s.
    const stillSeeking = pictureFor(skipping, 0.8, { seconds: 101.2, seeking: true });
    const doneSeeking = pictureFor(skipping, 0.8, { seconds: 101.2, seeking: false });

    expect([stillSeeking.seek, doneSeeking.seek]).toEqual([false, true]);
  });
});
