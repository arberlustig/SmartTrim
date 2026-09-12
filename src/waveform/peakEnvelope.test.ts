import { describe, expect, test } from "vitest";
import type { MonoPcm } from "../speech/detectSpeech";
import { peakEnvelope } from "./peakEnvelope";

/** A MonoPcm of `seconds` at 16 kHz, every sample at the same amplitude. */
function steady(amplitude: number, seconds: number): MonoPcm {
  return { sampleRate: 16000, samples: new Int16Array(16000 * seconds).fill(amplitude) };
}

describe("the numbers the waveform is drawn from", () => {
  // 16384 is exactly half of Int16's 32768, so the expected 0.5 is a known value rather than the code's own sum.
  test("a sound at half the amplitude draws half as tall", () => {
    expect([...peakEnvelope(steady(16384, 1), 20)]).toEqual(Array(20).fill(0.5));
  });

  // The reason each slice reports its loudest sample rather than its average: a gunshot lasting a hundredth of a
  // second has to stay visible, or the waveform stops matching what the Recording sounds like.
  test("a bang far shorter than one slice keeps its full height", () => {
    const pcm = steady(0, 1);
    // One single sample at full scale, in the slice covering 0.50 to 0.55 seconds.
    pcm.samples[8200] = -32768;

    const peaks = [...peakEnvelope(pcm, 20)];

    expect(peaks[10]).toBe(1);
    expect(peaks.filter((height) => height !== 0)).toEqual([1]);
  });

  test("silence draws nothing at all", () => {
    expect([...peakEnvelope(steady(0, 1), 20)]).toEqual(Array(20).fill(0));
  });

  // Recordings do not end on a round slice. The last, shorter slice still has to be measured and reported.
  test("a length that does not divide evenly still ends with a measured slice", () => {
    const pcm: MonoPcm = { sampleRate: 16000, samples: new Int16Array(16000 + 400).fill(16384) };

    const peaks = peakEnvelope(pcm, 20);

    expect(peaks).toHaveLength(21);
    expect(peaks[20]).toBe(0.5);
  });

  // Asking for no peaks per second used to hand back an empty waveform, which the window would have drawn as a
  // flat line — a Recording that looks silent. A refusal says what happened.
  test("refuses a resolution that cannot draw anything", () => {
    expect(() => peakEnvelope(steady(16384, 1), 0)).toThrow();
    expect(() => peakEnvelope(steady(16384, 1), -5)).toThrow();
  });
});
