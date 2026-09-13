import type { TimeRange } from "../cutting/planCuts.ts";
import type { Excerpt } from "./readExcerpt.ts";

/**
 * The owner's limit on an Excerpt: three minutes of stereo at 48 kHz are 33 MB, read in well under a second
 * (ADR-0022). It lives here rather than beside `readExcerpt` because the window needs it too, and that module runs
 * ffmpeg.
 */
export const LONGEST_EXCERPT_SECONDS = 180;

/** Where two kept stretches meet in what is played, and which stretch of the Recording was skipped there. */
export interface Join {
  /** How far into what is played the Join comes. */
  playedSeconds: number;
  removedFromSeconds: number;
  removedToSeconds: number;
}

/** One kept stretch as it is played: where it lies in the Recording, and where it starts in what is played. */
export interface PlayedPiece {
  recordingFromSeconds: number;
  recordingToSeconds: number;
  playedFromSeconds: number;
}

/** The sound the window plays, and where its Joins are (CONTEXT.md). */
export interface Playback {
  sampleRate: number;
  channelCount: number;
  /** 16-bit samples with the Channels interleaved, as in the Excerpt. */
  samples: Int16Array;
  pieces: PlayedPiece[];
  joins: Join[];
}

/**
 * Builds what is played from an Excerpt. Skipping what the cut removes, the kept stretches inside the Excerpt are
 * put back to back, each cut at the sample nearest its edge, so every Join sits where Premiere's sequence will
 * have its cut and nowhere else (ADR-0022).
 */
export function playbackOf(excerpt: Excerpt, kept: readonly TimeRange[], skipRemoved: boolean): Playback {
  const { sampleRate, channelCount, samples, fromSeconds } = excerpt;
  const frames = samples.length / channelCount;
  const firstFrame = fromSeconds * sampleRate;
  // Edges become whole frames of the Excerpt, and seconds are computed back from those frames, so the numbers the
  // window shows describe exactly the samples it plays.
  const frameAt = (seconds: number) => Math.min(Math.max(Math.round(seconds * sampleRate - firstFrame), 0), frames);
  const secondsAt = (frame: number) => (firstFrame + frame) / sampleRate;

  // Not skipping, the Excerpt is one piece from its first frame to its last, whatever the cut says.
  const pieces: (readonly [number, number])[] = skipRemoved ? [] : [[0, frames]];
  for (const range of skipRemoved ? kept : []) {
    const start = frameAt(range.startSeconds);
    const end = frameAt(range.endSeconds);
    if (end > start) pieces.push([start, end]);
  }
  // Playing nothing would sound like a Recording nobody made a sound on, and the Playhead would have nowhere to be.
  if (pieces.length === 0) {
    throw new Error(
      `The cut keeps nothing between ${secondsAt(0)} s and ${secondsAt(frames)} s, so skipping what it removes leaves nothing to play.`,
    );
  }

  const played = new Int16Array(pieces.reduce((total, [start, end]) => total + (end - start) * channelCount, 0));
  const playedPieces: PlayedPiece[] = [];
  const joins: Join[] = [];
  let playedFrames = 0;
  pieces.forEach(([start, end], index) => {
    const before = pieces[index - 1];
    if (before) {
      joins.push({
        playedSeconds: playedFrames / sampleRate,
        removedFromSeconds: secondsAt(before[1]),
        removedToSeconds: secondsAt(start),
      });
    }
    playedPieces.push({
      recordingFromSeconds: secondsAt(start),
      recordingToSeconds: secondsAt(end),
      playedFromSeconds: playedFrames / sampleRate,
    });
    played.set(samples.subarray(start * channelCount, end * channelCount), playedFrames * channelCount);
    playedFrames += end - start;
  });

  return { sampleRate, channelCount, samples: played, pieces: playedPieces, joins };
}

/**
 * The moment of the Recording being heard after `playedSeconds` of a Playback, for the Playhead over the waveform.
 * At a Join it is already the start of the next kept stretch; past the end it stays where the sound stopped.
 */
export function recordingSecondsAt(playback: Playback, playedSeconds: number): number {
  let heard = playback.pieces[0]?.recordingFromSeconds ?? Number.NaN;
  for (const piece of playback.pieces) {
    if (playedSeconds < piece.playedFromSeconds) break;
    heard = Math.min(piece.recordingFromSeconds + (playedSeconds - piece.playedFromSeconds), piece.recordingToSeconds);
  }
  return heard;
}
