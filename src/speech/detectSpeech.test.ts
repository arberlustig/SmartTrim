import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { detectSpeech, speechRanges } from "./detectSpeech";

// Silero scores one probability per 512 samples at 16 kHz, so every entry is one 32 ms chunk.
const chunks = (count: number, probability: number) => Array<number>(count).fill(probability);

describe("speechRanges", () => {
  test("speech starts with the first chunk scoring 0.5 and ends where the silence after it begins", () => {
    const probabilities = [...chunks(2, 0.1), ...chunks(10, 0.9), ...chunks(10, 0.1)];

    expect(speechRanges(probabilities)).toEqual([{ startSeconds: 0.064, endSeconds: 0.384 }]);
  });

  // Silero's reference keeps speech only when it lasts strictly longer than 250 ms: 7 chunks are 224 ms, 8 are 256 ms.
  test("speech lasting 250 ms or less is dropped as a blip", () => {
    const probabilities = [
      ...chunks(10, 0.1),
      ...chunks(7, 0.9),
      ...chunks(10, 0.1),
      ...chunks(8, 0.9),
      ...chunks(10, 0.1),
    ];

    expect(speechRanges(probabilities)).toEqual([{ startSeconds: 0.864, endSeconds: 1.12 }]);
  });

  // Silero's reference ends speech only after 100 ms of silence: 2 chunks are 64 ms, 10 are 320 ms.
  test("a pause shorter than 100 ms stays inside the speech, a longer one ends it", () => {
    const probabilities = [
      ...chunks(10, 0.9),
      ...chunks(2, 0.1),
      ...chunks(10, 0.9),
      ...chunks(10, 0.1),
      ...chunks(10, 0.9),
      ...chunks(10, 0.1),
    ];

    expect(speechRanges(probabilities)).toEqual([
      { startSeconds: 0, endSeconds: 0.704 },
      { startSeconds: 1.024, endSeconds: 1.344 },
    ]);
  });

  // Silero's reference hysteresis: speech starts at 0.5, but only a chunk below 0.35 (0.5 - 0.15) begins a pause.
  test("chunks scoring between 0.35 and 0.5 neither start speech nor end it", () => {
    const probabilities = [...chunks(5, 0.4), ...chunks(5, 0.9), ...chunks(10, 0.4), ...chunks(10, 0.1)];

    expect(speechRanges(probabilities)).toEqual([{ startSeconds: 0.16, endSeconds: 0.64 }]);
  });

  test("speech still going when the audio ends runs to the end of the audio", () => {
    const probabilities = [...chunks(5, 0.1), ...chunks(10, 0.9)];

    expect(speechRanges(probabilities)).toEqual([{ startSeconds: 0.16, endSeconds: 0.48 }]);
  });
});

// fixtures/speech/ is built by bench/make_speech_fixture.ts: Windows' synthesized voice between digital silence and
// pink noise. Its JSON gives where the voice lies, measured from the voice's own level, never by a speech detector.
const fixture = (name: string) => new URL(`../../fixtures/speech/${name}`, import.meta.url);
const syntheticPcm = readFileSync(fixture("synthetic-speech-16k.pcm"));
const syntheticSpeech = new Int16Array(
  syntheticPcm.buffer.slice(syntheticPcm.byteOffset, syntheticPcm.byteOffset + syntheticPcm.byteLength),
);
const syntheticLayout = JSON.parse(readFileSync(fixture("synthetic-speech-16k.json"), "utf8")) as {
  layout: { kind: string; startSeconds: number; endSeconds: number }[];
};
const voice = syntheticLayout.layout.filter((piece) => piece.kind === "speech");

// vendor/ is git-ignored and must be present.
const sileroModel = fileURLToPath(new URL("../../vendor/silero_vad.onnx", import.meta.url));

describe("detectSpeech", () => {
  // CLAUDE.md: without 64 samples of context before every 512-sample chunk, Silero scores everything near 0.0007 and
  // this finds nothing at all. Silero reacts within a few chunks, so each edge may lie up to 0.15 s from the voice's.
  test("finds speech where the synthesized voice speaks and nowhere in the silence or noise around it", async () => {
    const ranges = await detectSpeech({ sampleRate: 16000, samples: syntheticSpeech }, sileroModel);

    expect(ranges).toHaveLength(voice.length);
    ranges.forEach((range, index) => {
      expect(Math.abs(range.startSeconds - (voice[index]?.startSeconds ?? NaN))).toBeLessThanOrEqual(0.15);
      expect(Math.abs(range.endSeconds - (voice[index]?.endSeconds ?? NaN))).toBeLessThanOrEqual(0.15);
    });
  });

  // Chunk and context sizes are fixed for 16 kHz, the rate SmartTrim decodes to (ADR-0004).
  test("audio that is not 16 kHz is refused instead of scored at the wrong speed", async () => {
    await expect(detectSpeech({ sampleRate: 48000, samples: syntheticSpeech }, sileroModel)).rejects.toThrow(
      "Speech detection needs 16000 Hz audio; this audio is 48000 Hz.",
    );
  });
});
