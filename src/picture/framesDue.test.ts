import { describe, expect, test } from "vitest";
import type { TimeRange } from "../cutting/planCuts";
import { playbackOf } from "../playback/playback";
import type { Excerpt } from "../playback/readExcerpt";
import { framesDue, pictureRateOf } from "./framesDue";

/** Kept stretches the way the window gets them: seconds into the Recording, end exclusive. */
const kept = (...pairs: readonly (readonly [number, number])[]): TimeRange[] =>
  pairs.map(([startSeconds, endSeconds]) => ({ startSeconds, endSeconds }));

/** An Excerpt of silence at 10 samples per second; only its timing matters here. */
function excerptOf(fromSeconds: number, seconds: number): Excerpt {
  const silence = () => new Float32Array(seconds * 10);
  return { fromSeconds, sampleRate: 10, channelCount: 2, channels: [silence(), silence()] };
}

/** A Recording at 10 frames a second, so frame numbers read as tenths of a second: frame 1012 is at 101.2 s. */
const recording = { frameRate: { numerator: 10, denominator: 1 }, durationFrames: 2000 };

describe("which frame is due", () => {
  // 3 s of Recording from 100 s, skipping what is removed: kept until 100.5 s, 101.2 to 101.8 s, from 102.5 s on. The
  // first Join comes after 0.5 s played, where the sound goes on at 101.2 s.
  test("the frame due follows the moment heard, and the frames ahead jump at a Join as the sound does", () => {
    const played = playbackOf(excerptOf(100, 3), kept([99, 100.5], [101.2, 101.8], [102.5, 110]), true);

    expect(framesDue(played, 0, recording, 0).due).toBe(1000);
    expect(framesDue(played, 0.25, recording, 0).due).toBe(1002);
    expect(framesDue(played, 0.55, recording, 0).due).toBe(1012);
    // From 0.35 s played, the next 0.45 s show 100.35 and 100.45 s, then after the Join 101.25, 101.35 and 101.45 s.
    expect(framesDue(played, 0.35, recording, 0.45)).toEqual({ due: 1003, ahead: [1003, 1004, 1012, 1013, 1014] });
  });

  // The sound starts a moment after ▶ is pressed, and until then the picture shows where it will start. At the other
  // end, the moment after the last frame has no frame of its own — a Playhead put at the very end of a Recording asked
  // the prototype for a frame that never came.
  test("before the sound starts it is the first frame, and nothing lies past the Recording's last frame", () => {
    const played = playbackOf(excerptOf(100, 3), kept([0, 200]), false);

    expect(framesDue(played, -0.2, recording, 0).due).toBe(1000);
    // The Recording ends at 102.5 s, frame 1024 its last.
    expect(framesDue(played, 2.9, { ...recording, durationFrames: 1025 }, 0.3)).toEqual({ due: 1024, ahead: [1024] });
  });

  // The owner took 60 frames a second as enough. Above that the picture takes every second or third frame, so three
  // minutes of a 120 or 144 fps Recording fit the memory three minutes at 60 do. Frame numbers count the picture's own.
  test("above 60 frames a second the picture takes every second or third frame of the Recording, and counts its own", () => {
    const played = playbackOf(excerptOf(100, 3), kept([0, 200]), false);
    const at120 = { frameRate: { numerator: 120, denominator: 1 }, durationFrames: 24000 };

    expect(pictureRateOf(at120)).toEqual({ step: 2, perSecond: 60 });
    expect(pictureRateOf({ frameRate: { numerator: 144, denominator: 1 }, durationFrames: 1 })).toEqual({ step: 3, perSecond: 48 });
    expect(pictureRateOf({ frameRate: { numerator: 60000, denominator: 1001 }, durationFrames: 1 }).step).toBe(1);
    // 100.5 s is frame 12060 of the Recording and frame 6030 of its picture.
    expect(framesDue(played, 0.5, at120, 0.02)).toEqual({ due: 6030, ahead: [6030, 6031] });
  });
});
