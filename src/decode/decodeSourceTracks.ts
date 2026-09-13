import { spawn } from "node:child_process";
import type { RecordingInfo } from "../export/exportFcp7Xml";
import type { MonoPcm } from "../speech/detectSpeech";

// Speech detection needs 16 kHz mono (ADR-0010), kept in memory as 16-bit samples (ADR-0004).
const DECODE_SAMPLE_RATE = 16000;

/**
 * Decodes SourceTracks of a Recording to 16 kHz mono PCM held in memory (ADR-0004); nothing is written to disk.
 * Every requested SourceTrack gets its own ffmpeg process and all run at once, which on a coarsely interleaved
 * Recording lets each process skip the video (ADR-0005). Each SourceTrack is handed to `keep` the moment it
 * finishes, and what `keep` returns comes back, in the order the SourceTracks were asked for.
 */
export function decodeSourceTracks<Kept>(
  recording: RecordingInfo,
  sourceTrackIndexes: readonly number[],
  ffmpegPath: string,
  /**
   * What to keep of one decoded SourceTrack. Its audio is let go as soon as this returns, unless the result holds on
   * to it. Holding every SourceTrack's audio until the last one finished made the peak while reading far higher than
   * anything that is kept afterwards (ADR-0011).
   */
  keep: (sourceTrackIndex: number, pcm: MonoPcm) => Kept,
  /**
   * Called as each SourceTrack finishes, so the window can say how far it has got. They are decoded side by side
   * and finish in no particular order, which is why this reports a count rather than a position.
   */
  onDecoded?: (done: number, total: number) => void,
): Promise<Kept[]> {
  let done = 0;
  return Promise.all(
    sourceTrackIndexes.map(async (index) => {
      const kept = keep(index, await decodeSourceTrack(recording.path, index, ffmpegPath));
      done += 1;
      onDecoded?.(done, sourceTrackIndexes.length);
      return kept;
    }),
  );
}

function decodeSourceTrack(path: string, sourceTrackIndex: number, ffmpegPath: string): Promise<MonoPcm> {
  // 0:a:N is the Nth audio stream, the order RecordingInfo lists SourceTracks in; -ac 1 mixes both Channels.
  const args = [
    ...["-v", "error", "-nostdin", "-i", path],
    ...["-map", `0:a:${sourceTrackIndex}`, "-ac", "1", "-ar", String(DECODE_SAMPLE_RATE)],
    ...["-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
  ];
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    // Every byte of both outputs is kept; nothing caps them (CLAUDE.md).
    const chunks: Buffer[] = [];
    const messages: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => messages.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      const failure = `ffmpeg could not decode SourceTrack ${sourceTrackIndex + 1} of ${path}`;
      if (code !== 0) {
        const reason = Buffer.concat(messages).toString("utf8").trim() || `exit code ${code}`;
        reject(new Error(`${failure}: ${reason}`));
        return;
      }
      const byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
      if (byteLength % 2 !== 0) {
        reject(new Error(`${failure}: its output ended with half a sample.`));
        return;
      }
      const samples = new Int16Array(byteLength / 2);
      const bytes = new Uint8Array(samples.buffer);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve({ sampleRate: DECODE_SAMPLE_RATE, samples });
    });
  });
}
