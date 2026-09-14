import { spawn } from "node:child_process";
import type { RecordingInfo, SourceTrackInfo } from "../export/exportFcp7Xml.ts";
import { LONGEST_EXCERPT_SECONDS } from "./playback.ts";

/** The sound of one SourceTrack over a stretch of the Recording, read to be listened to (CONTEXT.md). */
export interface Excerpt {
  /** Where in the Recording the first sample belongs. */
  fromSeconds: number;
  sampleRate: number;
  channelCount: number;
  /**
   * One run of samples per Channel, left first, from -1 to 1 — the numbers Web Audio takes, as the AAC decoder makes
   * them. Handed over like this the window copies each Channel in whole when ▶ is pressed; converting three minutes of
   * samples on its own thread stood it still for up to half a second (ADR-0028).
   */
  channels: Float32Array[];
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
  const channelNumbers = Array.from({ length: channelCount }, (_unused, channel) => channel);
  // Every Channel comes out on a pipe of its own as 32-bit floats, so nothing here converts or pulls apart a single
  // sample: measured on three minutes of stereo, 13 ms to copy them against 50 ms to convert 16-bit interleaved
  // samples (ADR-0028). Channel 1 is stdout, Channel 2 is pipe 3, and so on; pipe 2 is ffmpeg's own messages.
  const graph =
    `[0:a:${sourceTrack}]asplit=${channelCount}${channelNumbers.map((channel) => `[s${channel}]`).join("")};` +
    channelNumbers.map((channel) => `[s${channel}]pan=mono|c0=c${channel}[c${channel}]`).join(";");
  const pipeOf = (channel: number) => (channel === 0 ? 1 : channel + 2);
  const args = [
    // -t before the input bounds what is read; after it, it would bound the first Channel's output only.
    ...["-v", "error", "-nostdin", "-ss", String(fromSeconds), "-t", String(toSeconds - fromSeconds), "-i", recording.path],
    ...["-filter_complex", graph],
    ...channelNumbers.flatMap((channel) => [
      ...["-map", `[c${channel}]`, "-ar", String(sampleRate), "-c:a", "pcm_f32le", "-f", "f32le", `pipe:${pipeOf(channel)}`],
    ]),
  ];
  return new Promise((resolve, reject) => {
    const stdio: ("ignore" | "pipe")[] = ["ignore", "pipe", "pipe", ...channelNumbers.slice(1).map((): "pipe" => "pipe")];
    const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true, stdio });
    // Every byte of every output is kept; nothing caps them (CLAUDE.md).
    const chunks: Buffer[][] = channelNumbers.map(() => []);
    const messages: Buffer[] = [];
    for (const channel of channelNumbers) {
      ffmpeg.stdio[pipeOf(channel)]?.on("data", (chunk: Buffer) => (chunks[channel] as Buffer[]).push(chunk));
    }
    ffmpeg.stdio[2]?.on("data", (chunk: Buffer) => messages.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      const failure = `ffmpeg could not read SourceTrack ${sourceTrack + 1} of ${recording.path} from ${fromSeconds} s to ${toSeconds} s`;
      if (code !== 0) {
        const reason = Buffer.concat(messages).toString("utf8").trim() || `exit code ${code}`;
        reject(new Error(`${failure}: ${reason}`));
        return;
      }
      const outputs = chunks.map((pieces) => Buffer.concat(pieces));
      const first = outputs[0] as Buffer;
      // Past the end of a SourceTrack ffmpeg writes nothing and still exits as if it had succeeded (ADR-0009: a later
      // SourceTrack can end before the video). An empty Excerpt would be played as silence, or not at all.
      if (first.length === 0) {
        reject(new Error(`${failure}: ffmpeg read nothing there; the SourceTrack may end before ${fromSeconds} s.`));
        return;
      }
      if (outputs.some((bytes) => bytes.length % 4 !== 0)) {
        reject(new Error(`${failure}: its output ended in the middle of a sample.`));
        return;
      }
      if (outputs.some((bytes) => bytes.length !== first.length)) {
        reject(new Error(`${failure}: its Channels came out of different lengths.`));
        return;
      }
      // Copied into arrays of their own, so the samples start on a whole float and outlive the pooled buffers.
      const channels = outputs.map((bytes) => {
        const samples = new Float32Array(bytes.length / 4);
        new Uint8Array(samples.buffer).set(bytes);
        return samples;
      });
      resolve({ fromSeconds, sampleRate, channelCount, channels });
    });
  });
}
