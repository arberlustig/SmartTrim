import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { FrameRate } from "../cutting/planCuts";
import type { RecordingInfo } from "../export/exportFcp7Xml";

const execFileAsync = promisify(execFile);

/**
 * Probes a Recording with ffprobe, which reads its stream descriptions without reading through the file.
 * `ffprobePath` is passed in because vendor/ is downloaded on first run and where it lands is not settled yet.
 * The arguments match those that captured fixtures/ffprobe/.
 */
export async function probeRecording(recordingPath: string, ffprobePath: string): Promise<RecordingInfo> {
  const path = resolve(recordingPath);
  // Output beyond maxBuffer makes execFile fail rather than truncate (CLAUDE.md). Each stream description takes a
  // few kilobytes, so no real Recording comes near 64 MB.
  const args = ["-v", "error", "-print_format", "json", "-show_streams", path];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(ffprobePath, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (error) {
    // execFile's own message repeats the whole command line; ffprobe's stderr says what went wrong.
    const reason = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
    throw new Error(`ffprobe could not read ${path}: ${reason}`, { cause: error });
  }
  return recordingInfoFromProbe(path, stdout);
}

/** The fields SmartTrim reads from `ffprobe -show_streams`; everything else ffprobe reports is ignored. */
interface ProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  time_base?: string;
  start_pts?: number;
  duration_ts?: number;
  nb_frames?: string;
  channels?: number;
  sample_rate?: string;
  bits_per_sample?: number;
}

/** ffprobe writes frame rates and time bases as "numerator/denominator". */
function parseRatio(ratio: string): FrameRate {
  const [numerator, denominator] = ratio.split("/").map(Number);
  return { numerator: numerator ?? NaN, denominator: denominator ?? NaN };
}

/** Turns ffprobe's JSON description of a Recording into everything the export needs. */
export function recordingInfoFromProbe(path: string, ffprobeOutput: string): RecordingInfo {
  const { streams } = JSON.parse(ffprobeOutput) as { streams: ProbeStream[] };
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const video = videoStreams[0];
  if (videoStreams.length !== 1 || !video) {
    throw new Error(`${path} has ${videoStreams.length} video streams; exactly one is needed.`);
  }
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  const labelOf = (stream: ProbeStream) =>
    stream === video ? "the video stream" : `SourceTrack ${audio.indexOf(stream) + 1}`;

  /** Reads a field ffprobe must have reported for a stream. A missing value is refused, never guessed. */
  const read = <Field extends keyof ProbeStream>(stream: ProbeStream, field: Field) => {
    const value = stream[field];
    if (value === undefined) throw new Error(`${path}: ${labelOf(stream)} reports no ${field}.`);
    return value as NonNullable<ProbeStream[Field]>;
  };

  // The export places every SourceTrack's clips at the same Recording frames as the video's, which only holds when
  // every stream starts with the Recording.
  for (const stream of [video, ...audio]) {
    const startPts = read(stream, "start_pts");
    if (startPts !== 0) {
      throw new Error(`${path}: ${labelOf(stream)} starts at pts ${startPts}, not at the start of the Recording.`);
    }
  }

  const frameRate = parseRatio(read(video, "r_frame_rate"));
  const durationFrames = Number(read(video, "nb_frames"));

  // How many frames at the Recording's frame rate a stream's duration spans, as an exact fraction.
  const framesSpanned = (stream: ProbeStream) => {
    const timeBase = parseRatio(read(stream, "time_base"));
    return {
      numerator: BigInt(read(stream, "duration_ts")) * BigInt(timeBase.numerator) * BigInt(frameRate.numerator),
      denominator: BigInt(timeBase.denominator) * BigInt(frameRate.denominator),
    };
  };

  // Frame positions are only times if every frame lasts equally long, so the frames must fill the video's duration
  // exactly. Under a variable frame rate every cut would drift.
  const videoSpan = framesSpanned(video);
  if (BigInt(durationFrames) * videoSpan.denominator !== videoSpan.numerator) {
    const spanned = Number((Number(videoSpan.numerator) / Number(videoSpan.denominator)).toFixed(2));
    throw new Error(
      `${path} has ${durationFrames} video frames, but its video lasts ${spanned} frames at ${frameRate.numerator}/${frameRate.denominator} fps: the frame rate is not constant.`,
    );
  }

  // A stream's length in whole frames, rounded down. BigInt division rounds down exactly at any Recording length.
  const lastWholeFrame = (stream: ProbeStream) => {
    const span = framesSpanned(stream);
    return Number(span.numerator / span.denominator);
  };

  // AAC carries no bit depth (ffprobe reports 0); both Premiere exports write 16 for it. Any other codec must report
  // its own, because nothing shows what Premiere writes for, say, Opus.
  const bitDepthOf = (stream: ProbeStream, sourceTrackNumber: number) => {
    const codec = read(stream, "codec_name");
    if (codec === "aac") return 16;
    const bitsPerSample = read(stream, "bits_per_sample");
    if (bitsPerSample === 0) {
      throw new Error(
        `${path}: SourceTrack ${sourceTrackNumber} is ${codec}, which reports no bit depth; only AAC is backed by a Premiere export.`,
      );
    }
    return bitsPerSample;
  };

  return {
    path,
    frameRate,
    width: read(video, "width"),
    height: read(video, "height"),
    durationFrames,
    sourceTracks: audio.map((stream, index) => ({
      channelCount: read(stream, "channels"),
      sampleRate: Number(read(stream, "sample_rate")),
      bitDepth: bitDepthOf(stream, index + 1),
      // ADR-0009: Premiere gives the first SourceTrack the video's length whatever its own, and ends every later
      // SourceTrack at its last whole frame. In long-recording.mp4 all six streams are identical, yet Premiere counts
      // 546692 frames for the first and 546690 for the rest.
      durationFrames: index === 0 ? durationFrames : lastWholeFrame(stream),
    })),
  };
}
