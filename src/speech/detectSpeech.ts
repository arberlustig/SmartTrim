import { InferenceSession, Tensor } from "onnxruntime-node";
import type { TimeRange } from "../cutting/planCuts";

/** Mono PCM as SmartTrim keeps it in memory (ADR-0004). */
export interface MonoPcm {
  sampleRate: number;
  samples: Int16Array;
}

// Silero VAD at 16 kHz scores audio in chunks of 512 samples.
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 512;
// CLAUDE.md: Silero v5 needs the previous chunk's last 64 samples before every chunk. Fed a bare 512 samples it does
// not fail; it scores about 0.0007 for every chunk, which reads as "nobody ever speaks".
const CONTEXT_SAMPLES = 64;
// Defaults of Silero's reference post-processing (get_speech_timestamps). Sample counts keep comparisons exact.
const SPEECH_THRESHOLD = 0.5;
// Only a chunk below this begins a pause; chunks between the two thresholds change nothing.
const SILENCE_THRESHOLD = SPEECH_THRESHOLD - 0.15;
const MIN_SPEECH_SAMPLES = (SAMPLE_RATE * 250) / 1000;
const MIN_SILENCE_SAMPLES = (SAMPLE_RATE * 100) / 1000;

const secondsAtChunk = (chunkIndex: number) => (chunkIndex * CHUNK_SAMPLES) / SAMPLE_RATE;

/** Finds where someone speaks in 16 kHz mono PCM, scored by the Silero VAD model at `modelPath`. */
export async function detectSpeech(audio: MonoPcm, modelPath: string): Promise<TimeRange[]> {
  // Chunk and context sizes are Silero's for 16 kHz; audio at another rate would be scored as if played too fast.
  if (audio.sampleRate !== SAMPLE_RATE) {
    throw new Error(`Speech detection needs ${SAMPLE_RATE} Hz audio; this audio is ${audio.sampleRate} Hz.`);
  }
  const session = await InferenceSession.create(modelPath);
  try {
    // One window holds the context followed by the chunk. Before each chunk, the last CONTEXT_SAMPLES of the
    // previous window move to the front; the first chunk's context is silence, as in the reference.
    const window = new Float32Array(CONTEXT_SAMPLES + CHUNK_SAMPLES);
    const input = new Tensor("float32", window, [1, window.length]);
    const sampleRate = new Tensor("int64", BigInt64Array.of(BigInt(SAMPLE_RATE)), []);
    let state: Tensor = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);

    const chunkCount = Math.ceil(audio.samples.length / CHUNK_SAMPLES);
    const probabilities = new Float32Array(chunkCount);
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      window.copyWithin(0, CHUNK_SAMPLES);
      const chunkStart = chunk * CHUNK_SAMPLES;
      for (let offset = 0; offset < CHUNK_SAMPLES; offset++) {
        // The final chunk is padded with silence, as in the reference.
        window[CONTEXT_SAMPLES + offset] = (audio.samples[chunkStart + offset] ?? 0) / 32768;
      }
      const { output, stateN } = await session.run({ input, state, sr: sampleRate });
      if (!output || !stateN) throw new Error(`${modelPath} did not return "output" and "stateN".`);
      probabilities[chunk] = Number(output.data[0]);
      state = stateN;
    }
    return speechRanges(probabilities);
  } finally {
    await session.release();
  }
}

/** Turns Silero's per-chunk speech probabilities into the stretches where someone speaks. */
export function speechRanges(probabilities: Iterable<number>): TimeRange[] {
  const ranges: TimeRange[] = [];
  let speechStart: number | undefined;
  // Where the current pause began, while it has not yet lasted long enough to end the speech.
  let pauseStart: number | undefined;
  let chunkIndex = 0;
  for (const probability of probabilities) {
    if (probability >= SPEECH_THRESHOLD) {
      pauseStart = undefined;
      speechStart ??= chunkIndex;
    } else if (speechStart !== undefined && probability < SILENCE_THRESHOLD) {
      pauseStart ??= chunkIndex;
      // As in the reference, speech ends where the pause began once a quiet chunk lies the minimum silence after it,
      // and is kept only when strictly longer than the minimum speech.
      if ((chunkIndex - pauseStart) * CHUNK_SAMPLES >= MIN_SILENCE_SAMPLES) {
        if ((pauseStart - speechStart) * CHUNK_SAMPLES > MIN_SPEECH_SAMPLES) {
          ranges.push({ startSeconds: secondsAtChunk(speechStart), endSeconds: secondsAtChunk(pauseStart) });
        }
        speechStart = undefined;
        pauseStart = undefined;
      }
    }
    chunkIndex++;
  }
  // As in the reference, speech still open when the audio ends closes with the audio, even during a pause too short
  // to end it. The last chunk counts whole, so the end can lie up to 31 ms past the audio; planCuts clamps it.
  if (speechStart !== undefined && (chunkIndex - speechStart) * CHUNK_SAMPLES > MIN_SPEECH_SAMPLES) {
    ranges.push({ startSeconds: secondsAtChunk(speechStart), endSeconds: secondsAtChunk(chunkIndex) });
  }
  return ranges;
}
