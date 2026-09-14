import type { PlayedPiece } from "../playback/playback.ts";
import type { DecoderConfig, IndexedFrame, VideoIndex } from "./videoIndex.ts";

/** A frame that goes on screen: which one, by its display time, and from which moment of what is played. */
export interface ShownFrame {
  /** In ticks of the index's timescale, as the decoder hands it back. */
  pts: number;
  playedSeconds: number;
}

/**
 * How the picture of one kept piece is decoded (ADR-0027): the frames fed to the decoder, and which of the frames it
 * turns out go on screen. Every other frame it turns out was decoded only to get there.
 */
export interface PiecePicture {
  /** In decode order, starting at a keyframe. The decoder is flushed after the last. */
  feed: IndexedFrame[];
  /** In the order they are shown. */
  shown: ShownFrame[];
}

/** What the window is handed to decode the picture of what is played: the decoder's configuration and each piece's plan. */
export interface PicturePlan {
  decoder: DecoderConfig;
  pieces: PiecePicture[];
}

/** What the window is handed to decode the still frame under the Playhead. */
export interface StillPicture {
  decoder: DecoderConfig;
  /** In decode order, starting at a keyframe. */
  feed: IndexedFrame[];
  /** The frame to show, by its display time. */
  pts: number;
}

/** The picture of each kept piece of what is played. */
export function picturePlanOf(index: VideoIndex, pieces: readonly PlayedPiece[]): PiecePicture[] {
  const { frames, timescale } = index;
  const ptsOf = (decoded: number) => frames[decoded]?.pts ?? 0;
  // Where the keyframes lie in decode order. They are shown in the order they are decoded, so the one a piece starts
  // from is found by halving: reading every frame of the long Recording for each of 80 pieces took 0.9 s.
  const keyframes: number[] = [];
  for (const [decoded, frame] of frames.entries()) if (frame.key) keyframes.push(decoded);

  return pieces.map(({ recordingFromSeconds, recordingToSeconds, playedFromSeconds }) => {
    // Decoding starts at the latest keyframe shown at or before the piece's first moment.
    let startKeyframe = 0;
    for (let low = 0, high = keyframes.length - 1; low <= high; ) {
      const middle = (low + high) >> 1;
      if (ptsOf(keyframes[middle] ?? 0) / timescale <= recordingFromSeconds) {
        startKeyframe = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const start = keyframes[startKeyframe] ?? 0;

    // The frames that go on screen, by their place in decode order: the one on screen at the piece's first moment,
    // which is the latest shown at or before it, and every one shown inside the piece after that. Frames decoded after
    // a keyframe can still be shown before it, but never after the keyframe that follows, so none lies past the second
    // keyframe shown after the piece.
    let onScreenAtStart: number | null = null;
    const shown: number[] = [];
    let keyframesAfter = 0;
    for (let decoded = start; decoded < frames.length; decoded++) {
      const frame = frames[decoded];
      if (!frame) break;
      const seconds = frame.pts / timescale;
      if (frame.key && seconds >= recordingToSeconds && ++keyframesAfter === 2) break;
      if (seconds > recordingFromSeconds) {
        if (seconds < recordingToSeconds) shown.push(decoded);
      } else if (onScreenAtStart === null || frame.pts > ptsOf(onScreenAtStart)) {
        onScreenAtStart = decoded;
      }
    }
    if (onScreenAtStart !== null) shown.push(onScreenAtStart);
    shown.sort((one, other) => ptsOf(one) - ptsOf(other));

    // Decoding ends with the last of them to be decoded: a B-frame needs the frames decoded before it, never after.
    const lastDecoded = shown.reduce((last, decoded) => Math.max(last, decoded), start - 1);

    return {
      feed: frames.slice(start, lastDecoded + 1),
      shown: shown.map((decoded) => ({
        pts: ptsOf(decoded),
        playedSeconds: playedFromSeconds + Math.max(0, ptsOf(decoded) / timescale - recordingFromSeconds),
      })),
    };
  });
}

/** The still picture under the Playhead: the frame on screen at a moment of the Recording, and what to decode for it. */
export function stillFrameOf(index: VideoIndex, seconds: number): { feed: IndexedFrame[]; pts: number } {
  // A piece that ends where it starts holds nothing but the frame on screen at its first moment.
  const [piece] = picturePlanOf(index, [{ recordingFromSeconds: seconds, recordingToSeconds: seconds, playedFromSeconds: 0 }]);
  return { feed: piece?.feed ?? [], pts: piece?.shown[0]?.pts ?? 0 };
}
