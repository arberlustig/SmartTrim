import { spawn } from "node:child_process";
import type { RecordingInfo, SourceTrackInfo } from "../export/exportFcp7Xml.ts";
import { LONGEST_EXCERPT_SECONDS } from "./playback.ts";

/** The sound of one SourceTrack over a stretch of the Recording, read to be listened to (CONTEXT.md). */
export interface Excerpt {
  /** Where in the Recording the first sample belongs. */
  fromSeconds: number;
  sampleRate: number;
  channelCount: number;
  /** 16-bit samples with the Channels interleaved: left, right, left, right … */
  samples: Int16Array;
}

/**
 * Reads one SourceTrack of a Recording from `fromSeconds` to `toSeconds` with ffmpeg, in its own sample rate and
 * Channel layout as probed — never resampled, never mixed down. Seeking before the input is what makes this fast
 * on a 23 GB Recording, and at the SourceTrack's own rate it lands on the same sample as decoding from the start
 * (measured in ADR-0022).
 */
export async function readExcerpt(
  recording: RecordingInfo,
  sourceTrack: number,
  fromSeconds: number,
  toSeconds: number,
  ffmpegPath: string,
): Promise<Excerpt> {
  const info: SourceTrackInfo | undefined = recording.sourceTracks[sourceTrack];
  if (!info) {
    throw new Error(`${recording.path} has no SourceTrack ${sourceTrack + 1}; it has ${recording.sourceTracks.length}.`);
  }
  // An empty Excerpt would play as silence, which sounds like a Recording nobody made a sound on.
  if (!(toSeconds > fromSeconds)) throw new Error(`${fromSeconds} s to ${toSeconds} s has no length to listen to.`);
  // A millisecond of slack: the window asks for a start plus the limit, and from a start with many decimals adding
  // and subtracting again comes out a hair over it — about one press in thirty was refused for that alone.
  if (toSeconds - fromSeconds > LONGEST_EXCERPT_SECONDS + 0.001) {
    throw new Error(`${toSeconds - fromSeconds} s is longer than the ${LONGEST_EXCERPT_SECONDS} s an Excerpt may last.`);
  }

  const { sampleRate, channelCount } = info;
  const args = [
    ...["-v", "error", "-nostdin", "-ss", String(fromSeconds), "-i", recording.path],
    ...["-t", String(toSeconds - fromSeconds), "-map", `0:a:${sourceTrack}`],
    ...["-ac", String(channelCount), "-ar", String(sampleRate), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
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
      const failure = `ffmpeg could not read SourceTrack ${sourceTrack + 1} of ${recording.path} from ${fromSeconds} s to ${toSeconds} s`;
      if (code !== 0) {
        const reason = Buffer.concat(messages).toString("utf8").trim() || `exit code ${code}`;
        reject(new Error(`${failure}: ${reason}`));
        return;
      }
      const bytes = Buffer.concat(chunks);
      // Past the end of a SourceTrack ffmpeg writes nothing and still exits as if it had succeeded (ADR-0009: a later
      // SourceTrack can end before the video). An empty Excerpt would be played as silence, or not at all.
      if (bytes.length === 0) {
        reject(new Error(`${failure}: ffmpeg read nothing there; the SourceTrack may end before ${fromSeconds} s.`));
        return;
      }
      if (bytes.length % (2 * channelCount) !== 0) {
        reject(new Error(`${failure}: its output ended in the middle of a sample.`));
        return;
      }
      // Copied into an array of its own, so the samples start on an even byte and outlive the pooled buffer.
      const samples = new Int16Array(bytes.length / 2);
      new Uint8Array(samples.buffer).set(bytes);
      resolve({ fromSeconds, sampleRate, channelCount, samples });
    });
  });
}
