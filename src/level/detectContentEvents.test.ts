import { describe, expect, test } from "vitest";
import type { MonoPcm } from "../speech/detectSpeech";
import { detectContentEvents } from "./detectContentEvents";

const SAMPLE_RATE = 16000;

/** A seeded generator, so a failing test fails the same way twice. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648 - 0.5;
  };
}

/** Builds 16 kHz mono PCM out of stretches of a given level in dBFS; -Infinity is digital silence. */
function builtFrom(pieces: readonly { seconds: number; dbfs: number }[]): MonoPcm {
  const total = pieces.reduce((sum, piece) => sum + Math.round(piece.seconds * SAMPLE_RATE), 0);
  const samples = new Int16Array(total);
  const random = noise(7);
  let at = 0;
  for (const piece of pieces) {
    // A uniform signal in [-a, a] has an RMS of a / sqrt(3), which is what the level has to describe.
    const amplitude = piece.dbfs === -Infinity ? 0 : 32768 * 10 ** (piece.dbfs / 20) * Math.sqrt(3);
    for (let end = at + Math.round(piece.seconds * SAMPLE_RATE); at < end; at++) {
      samples[at] = Math.max(-32768, Math.min(32767, Math.round(random() * 2 * amplitude)));
    }
  }
  return { sampleRate: SAMPLE_RATE, samples };
}

describe("detectContentEvents", () => {
  // The explosion in a quiet stretch: what the whole idea is for.
  test("a burst well above its own recent baseline is one event, as long as the burst", () => {
    const audio = builtFrom([
      { seconds: 10, dbfs: -45 },
      { seconds: 0.3, dbfs: -12 },
      { seconds: 10, dbfs: -45 },
    ]);

    const events = detectContentEvents(audio);

    expect(events).toHaveLength(1);
    expect(events[0]?.startSeconds).toBeCloseTo(10, 1);
    expect(events[0]?.endSeconds).toBeCloseTo(10.3, 1);
  });

  // CONTEXT.md: continuous background audio is never a ContentEvent, however loud. A gaming Recording is loud from
  // end to end, and keeping all of it would remove nothing.
  test("audio that is loud from end to end holds no events at all", () => {
    const events = detectContentEvents(builtFrom([{ seconds: 20, dbfs: -12 }]));

    expect(events).toEqual([]);
  });

  // Music starting and staying: the start is a moment, the rest is the new background. With a five-second baseline
  // the middle level flips once half the window is loud, so the moment lasts about two and a half seconds.
  test("a level that jumps and stays is a moment only until the baseline has caught up", () => {
    const events = detectContentEvents(
      builtFrom([
        { seconds: 10, dbfs: -45 },
        { seconds: 10, dbfs: -12 },
      ]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.startSeconds).toBeCloseTo(10, 1);
    expect(events[0]?.endSeconds).toBeGreaterThan(12);
    expect(events[0]?.endSeconds).toBeLessThan(13);
  });

  // CONTEXT.md names the abrupt drop as a ContentEvent of its own: the game or the music cutting out is worth seeing.
  test("an abrupt drop into silence is a moment as well", () => {
    const events = detectContentEvents(
      builtFrom([
        { seconds: 10, dbfs: -12 },
        { seconds: 10, dbfs: -Infinity },
      ]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.startSeconds).toBeCloseTo(10, 1);
    expect(events[0]?.endSeconds).toBeLessThan(13);
  });

  // Everything in the first window would have to be judged against a baseline that is not there yet.
  test("nothing is judged before there is a baseline to judge it against", () => {
    const events = detectContentEvents(
      builtFrom([
        { seconds: 1, dbfs: -12 },
        { seconds: 10, dbfs: -45 },
      ]),
      { baselineSeconds: 5 },
    );

    expect(events.every((event) => event.startSeconds >= 5)).toBe(true);
  });
});
