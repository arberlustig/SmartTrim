import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { TimeRange } from "../cutting/planCuts.ts";
import { detectLoudness } from "./detectLoudness.ts";

// The fixture that bench/make_speech_fixture.ts built: digital silence, a synthesized phrase, pink noise, a second
// phrase, digital silence. Measured levels: the silence is digital zero, the noise sits at -35 dBFS, the phrases
// between -20 and -29 dBFS.
const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/speech/${name}`, import.meta.url));
const pcmBytes = readFileSync(fixture("synthetic-speech-16k.pcm"));
const audio = {
  sampleRate: 16000,
  samples: new Int16Array(pcmBytes.buffer.slice(pcmBytes.byteOffset, pcmBytes.byteOffset + pcmBytes.byteLength)),
};
const layout = (
  JSON.parse(readFileSync(fixture("synthetic-speech-16k.json"), "utf8")) as {
    layout: { kind: string; startSeconds: number; endSeconds: number }[];
  }
).layout;
const section = (kind: string) => layout.find((piece) => piece.kind === kind) ?? { startSeconds: NaN, endSeconds: NaN };

/** How many seconds of one stretch of the fixture the ranges cover. */
const coveredSeconds = (ranges: readonly TimeRange[], from: number, to: number) =>
  ranges.reduce(
    (total, range) => total + Math.max(0, Math.min(range.endSeconds, to) - Math.max(range.startSeconds, from)),
    0,
  );

describe("detectLoudness", () => {
  // The 3 seconds of pink noise sit at -35 dBFS: a threshold below that keeps them, one above drops them. Loudness
  // cannot tell noise from a voice, which is exactly what the owner chose it for and what it costs.
  test("keeps what is louder than the threshold and drops what is quieter", () => {
    const noise = section("noise");

    expect({
      at45: Math.round(coveredSeconds(detectLoudness(audio, -45), noise.startSeconds, noise.endSeconds)),
      at30: Math.round(coveredSeconds(detectLoudness(audio, -30), noise.startSeconds, noise.endSeconds)),
    }).toEqual({ at45: 3, at30: 0 });
  });

  // Chunks become seconds at 16 kHz, the rate SmartTrim decodes to (ADR-0004).
  test("audio that is not 16 kHz is refused instead of timed wrongly", () => {
    expect(() => detectLoudness({ ...audio, sampleRate: 48000 }, -45)).toThrow(
      "Loudness detection needs 16000 Hz audio; this audio is 48000 Hz.",
    );
  });
});
