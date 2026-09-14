import { recordingSecondsAt, type Playback } from "../playback/playback.ts";

/** What the picture needs to know of a Recording's video to find its frames. */
export interface VideoTiming {
  frameRate: { numerator: number; denominator: number };
  durationFrames: number;
}

/** What the picture needs at one moment of what is played. */
export interface FramesDue {
  /** The frame of the Recording on screen now. */
  due: number;
  /** The frames the next moments show, `due` first, each once and in the order they come — across Joins as the sound goes. */
  ahead: number[];
}

/**
 * The frame on screen at `seconds` of the Recording: frame k from k / fps. The very end of the Recording has no frame
 * of its own; its last frame stays on screen there.
 */
export function frameAtSeconds(video: VideoTiming, seconds: number): number {
  const perSecond = video.frameRate.numerator / video.frameRate.denominator;
  // A hair above the frame's start, so 100.3 s read back as 100.29999999 still counts as frame 1003.
  return Math.min(Math.floor(seconds * perSecond + 1e-6), video.durationFrames - 1);
}

/**
 * The frame due at `audibleSeconds` of what is played — the moment leaving the speakers, so the picture keeps to the
 * sound as it is heard — and the frames the following `aheadSeconds` will show (ADR-0028).
 */
export function framesDue(playback: Playback, audibleSeconds: number, video: VideoTiming, aheadSeconds: number): FramesDue {
  const perSecond = video.frameRate.numerator / video.frameRate.denominator;
  const frameAt = (playedSeconds: number) => frameAtSeconds(video, recordingSecondsAt(playback, playedSeconds));
  const ahead: number[] = [];
  for (let step = 0; step / perSecond <= aheadSeconds + 1e-9; step += 1) {
    const frame = frameAt(audibleSeconds + step / perSecond);
    if (!ahead.includes(frame)) ahead.push(frame);
  }
  return { due: frameAt(audibleSeconds), ahead };
}
