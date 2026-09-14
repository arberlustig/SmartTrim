import { recordingSecondsAt, type Playback } from "../playback/playback.ts";

/** How high the picture's frames are made, in pixels: the picture is drawn at most 450 px high (ADR-0027). */
export const PICTURE_HEIGHT = 450;

/** The most frames a second the picture shows: the owner took 60 as enough (ADR-0028). */
const PICTURE_MOST_PER_SECOND = 60;

/** What the picture needs to know of a Recording to number its frames. */
export interface FrameTiming {
  frameRate: { numerator: number; denominator: number };
  durationFrames: number;
}

/** The picture's own rate: every `step`-th frame of the Recording, `perSecond` of them a second. */
export interface PictureRate {
  step: number;
  perSecond: number;
}

/**
 * How the picture thins a Recording out: not at all up to 60 frames a second, every second frame of 120, every third
 * of 144. Frame numbers of the picture count its own frames, so picture frame j is Recording frame j · step.
 */
export function pictureRateOf(recording: FrameTiming): PictureRate {
  const perSecond = recording.frameRate.numerator / recording.frameRate.denominator;
  // A hair below, so exactly 60 frames a second is not taken for more than 60.
  const step = Math.max(Math.ceil(perSecond / PICTURE_MOST_PER_SECOND - 1e-9), 1);
  return { step, perSecond: perSecond / step };
}

/** The picture's last frame: the one holding the Recording's last frame, or the last one before it. */
export function lastPictureFrameOf(recording: FrameTiming): number {
  return Math.floor((recording.durationFrames - 1) / pictureRateOf(recording).step);
}

/** How large the picture's frames are made: `height` high, in the Recording's own shape, an even number of pixels wide. */
export function pictureSizeOf(recording: { width: number; height: number }, height = PICTURE_HEIGHT): { width: number; height: number } {
  return { width: Math.round((height * recording.width) / recording.height / 2) * 2, height };
}

/**
 * The picture frame on screen at `seconds` of the Recording. The very end of the Recording has no frame of its own; the
 * last frame stays on screen there.
 */
export function frameAtSeconds(recording: FrameTiming, seconds: number): number {
  // A hair above the frame's start, so 100.3 s read back as 100.29999999 still counts as frame 1003 at 10 a second.
  const frame = Math.floor(seconds * pictureRateOf(recording).perSecond + 1e-6);
  return Math.min(Math.max(frame, 0), lastPictureFrameOf(recording));
}

/** What the picture needs at one moment of what is played. */
export interface FramesDue {
  /** The picture frame on screen now. */
  due: number;
  /** The frames the next moments show, `due` first, each once and in the order they come — across Joins as the sound goes. */
  ahead: number[];
}

/**
 * The frame due at `audibleSeconds` of what is played — the moment leaving the speakers, so the picture keeps to the
 * sound as it is heard — and the frames the following `aheadSeconds` will show (ADR-0028).
 */
export function framesDue(playback: Playback, audibleSeconds: number, recording: FrameTiming, aheadSeconds: number): FramesDue {
  const { perSecond } = pictureRateOf(recording);
  const frameAt = (playedSeconds: number) => frameAtSeconds(recording, recordingSecondsAt(playback, playedSeconds));
  const ahead: number[] = [];
  for (let step = 0; step / perSecond <= aheadSeconds + 1e-9; step += 1) {
    const frame = frameAt(audibleSeconds + step / perSecond);
    if (!ahead.includes(frame)) ahead.push(frame);
  }
  return { due: frameAt(audibleSeconds), ahead };
}
