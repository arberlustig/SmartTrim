import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";

const execFileAsync = promisify(execFile);

/** Anything quieter than this in every slice is taken as a SourceTrack nobody ever routed anything to. */
const SILENCE_FLOOR_DBFS = -70;

/** How much of the Recording a scan listens to by default: five slices of ten seconds, spread over its length. */
const DEFAULT_SLICES = 5;
const DEFAULT_SLICE_SECONDS = 10;

/** What one slice of one SourceTrack measured. Digital silence reports -Infinity, the way ffmpeg writes -inf. */
export interface SourceTrackLevel {
  peakDbfs: number;
  rmsDbfs: number;
}

/** What a scan found on one SourceTrack. A SourceTrack with `carriesSound: false` is an EmptyTrack (CONTEXT.md). */
export interface SourceTrackScan {
  carriesSound: boolean;
  /** The loudest peak any slice reached, -Infinity when every slice held nothing but zeroes. */
  peakDbfs: number;
  /** Slices that carried sound, so "only now and then" can be told apart from "all the way through". */
  slicesWithSound: number;
  sliceCount: number;
}

/** ffmpeg writes "-inf" for a stretch that holds nothing but zeroes. */
function toDbfs(text: string): number {
  return text.trim() === "-inf" ? -Infinity : Number(text);
}

/**
 * Reads the levels out of one `ffmpeg -filter_complex "...astats..."` run, one astats filter per SourceTrack.
 * The filters are named `Parsed_astats_<position>`, which is how a SourceTrack is identified: ffmpeg prints the
 * blocks in whatever order the filters finish, so reading them in the order they appear mixes the SourceTracks up.
 */
export function sourceTrackLevelsFromAstats(ffmpegOutput: string, sourceTrackCount: number): SourceTrackLevel[] {
  const peaks = new Map<number, number>();
  const rms = new Map<number, number>();
  const pattern = /Parsed_astats_(\d+) @ [^\]]*\] (Peak|RMS) level dB: (-?[\d.]+|-inf)/g;
  for (const [, position, measure, value] of ffmpegOutput.matchAll(pattern)) {
    const into = measure === "Peak" ? peaks : rms;
    into.set(Number(position), toDbfs(value ?? ""));
  }

  return Array.from({ length: sourceTrackCount }, (_unused, position) => {
    const peakDbfs = peaks.get(position);
    const rmsDbfs = rms.get(position);
    // A SourceTrack ffmpeg said nothing about must never be read as silence: that would hide a track in the window.
    if (peakDbfs === undefined || rmsDbfs === undefined) {
      throw new Error(`ffmpeg measured no level for SourceTrack ${position + 1}.`);
    }
    return { peakDbfs, rmsDbfs };
  });
}

/** Where the slices sit: spread evenly over the Recording, each one pulled inside its end. */
function sliceStarts(recordingSeconds: number, slices: number, sliceSeconds: number): number[] {
  const last = Math.max(recordingSeconds - sliceSeconds, 0);
  return Array.from({ length: slices }, (_unused, index) => {
    const middle = ((index + 0.5) * recordingSeconds) / slices;
    return Number(Math.min(Math.max(middle - sliceSeconds / 2, 0), last).toFixed(3));
  });
}

/** Measures one slice of every SourceTrack at once: one ffmpeg process reads the file once for all of them. */
async function measureSlice(
  recording: RecordingInfo,
  ffmpegPath: string,
  startSeconds: number,
  sliceSeconds: number,
): Promise<SourceTrackLevel[]> {
  const count = recording.sourceTracks.length;
  const positions = Array.from({ length: count }, (_unused, position) => position);
  const args = [
    ...["-hide_banner", "-v", "info"],
    // -ss before -i seeks instead of decoding up to the slice, which is what keeps this cheap on a 20 GB Recording.
    ...["-ss", String(startSeconds), "-t", String(sliceSeconds)],
    ...["-i", recording.path],
    ...[
      "-filter_complex",
      positions
        .map(
          (position) =>
            `[0:a:${position}]astats=metadata=1:measure_perchannel=none:measure_overall=Peak_level+RMS_level[a${position}]`,
        )
        .join(";"),
    ],
    ...positions.flatMap((position) => ["-map", `[a${position}]`]),
    ...["-f", "null", "-"],
  ];

  // astats writes to stderr, and a Recording with many SourceTracks fills a few kilobytes of it. Output beyond
  // maxBuffer makes execFile fail rather than truncate (CLAUDE.md), so a lost level is never read as silence.
  let stderr: string;
  try {
    ({ stderr } = await execFileAsync(ffmpegPath, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (error) {
    const reason = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
    throw new Error(
      `ffmpeg could not measure the SourceTracks of ${recording.path} at ${startSeconds} s: ${reason}`,
      { cause: error },
    );
  }
  return sourceTrackLevelsFromAstats(stderr, count);
}

/**
 * Listens to a few short slices of every SourceTrack to find out which of them carry anything at all, so the window
 * can hide the SourceTracks nobody was ever routed to. It only ever reads the Recording (ADR-0006).
 *
 * A slice is a sample, not proof: a SourceTrack that only makes a sound outside every slice looks empty. That is why
 * the window lets the user show the hidden SourceTracks, and why the export writes them all either way.
 */
export async function scanSourceTracks(
  recording: RecordingInfo,
  ffmpegPath: string,
  options: { slices?: number; sliceSeconds?: number } = {},
): Promise<SourceTrackScan[]> {
  const slices = options.slices ?? DEFAULT_SLICES;
  const sliceSeconds = options.sliceSeconds ?? DEFAULT_SLICE_SECONDS;
  if (slices < 1) throw new Error("A scan needs at least one slice.");
  const recordingSeconds =
    (recording.durationFrames * recording.frameRate.denominator) / recording.frameRate.numerator;

  const measured = await Promise.all(
    sliceStarts(recordingSeconds, slices, sliceSeconds).map((startSeconds) =>
      measureSlice(recording, ffmpegPath, startSeconds, sliceSeconds),
    ),
  );

  return recording.sourceTracks.map((_sourceTrack, position) => {
    const levels = measured.map((slice) => slice[position]?.peakDbfs ?? -Infinity);
    const slicesWithSound = levels.filter((peakDbfs) => peakDbfs > SILENCE_FLOOR_DBFS).length;
    return {
      carriesSound: slicesWithSound > 0,
      peakDbfs: Math.max(...levels),
      slicesWithSound,
      sliceCount: slices,
    };
  });
}
