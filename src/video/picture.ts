import { recordingSecondsAt, type Join, type Playback } from "../playback/playback.ts";

/**
 * How far the picture may lie from the sound before it is made to jump. A seek costs up to a quarter of a second of
 * frozen picture on the owner's Recordings, a keyframe every 4 s (ADR-0027), so a picture running a few frames apart
 * is left to run; a tenth of a second is where it starts to look out of step.
 */
export const PICTURE_SLACK_SECONDS = 0.1;

/** What the picture has to do at one moment of what is played. */
export interface PictureStep {
  /** The moment of the Recording that belongs on screen now. */
  wantedSeconds: number;
  /** True when the picture shown lies further than `PICTURE_SLACK_SECONDS` from it and has to jump. */
  seek: boolean;
  /** The next Join in what is played, so the picture after it can be made ready before the sound gets there. */
  nextJoin: Join | null;
}

/** What the picture on screen is doing: the moment of the Recording it shows, and whether it is still seeking there. */
export interface ShownPicture {
  seconds: number;
  seeking: boolean;
}

/**
 * Where the picture belongs after `playedSeconds` of a Playback, given what it `shown` now. The sound is the clock; the
 * picture only follows it.
 *
 * A picture still seeking is never told to seek again. While it seeks it reports the moment it is seeking to, and the
 * sound runs on past it; told to seek once more every frame, the seek starts over and never ends, and on the owner's
 * HEVC Recordings every abandoned seek left the graphics chip decoding up to four seconds of video (ADR-0027).
 */
export function pictureFor(playback: Playback, playedSeconds: number, shown: ShownPicture): PictureStep {
  const wantedSeconds = recordingSecondsAt(playback, playedSeconds);
  return {
    wantedSeconds,
    seek: !shown.seeking && Math.abs(shown.seconds - wantedSeconds) > PICTURE_SLACK_SECONDS,
    nextJoin: playback.joins.find((join) => join.playedSeconds > playedSeconds) ?? null,
  };
}
