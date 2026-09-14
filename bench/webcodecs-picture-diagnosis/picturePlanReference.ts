// The first, slow picturePlan (every frame read for every piece), kept only as the oracle for the faster one.
import type { IndexedFrame, VideoIndex } from "file:///C:/Users/user/source/repos/SmartTrim/src/video/videoIndex.ts";

interface Piece {
  recordingFromSeconds: number;
  recordingToSeconds: number;
  playedFromSeconds: number;
}

export function picturePlanOf(index: VideoIndex, pieces: readonly Piece[]) {
  const { frames, timescale } = index;
  const ptsOf = (decoded: number) => frames[decoded]?.pts ?? 0;

  return pieces.map(({ recordingFromSeconds, recordingToSeconds, playedFromSeconds }) => {
    let onScreenAtStart: number | null = null;
    const shown: number[] = [];
    for (const [decoded, frame] of frames.entries()) {
      const seconds = frame.pts / timescale;
      if (seconds > recordingFromSeconds) {
        if (seconds < recordingToSeconds) shown.push(decoded);
      } else if (onScreenAtStart === null || frame.pts > ptsOf(onScreenAtStart)) {
        onScreenAtStart = decoded;
      }
    }
    if (onScreenAtStart !== null) shown.push(onScreenAtStart);
    shown.sort((one, other) => ptsOf(one) - ptsOf(other));

    const firstPts = ptsOf(shown[0] ?? 0);
    const lastDecoded = shown.reduce((last, decoded) => Math.max(last, decoded), -1);
    let start = 0;
    for (let decoded = 0; decoded <= lastDecoded; decoded++) {
      const frame = frames[decoded];
      if (frame?.key && frame.pts <= firstPts) start = decoded;
    }

    return {
      feed: frames.slice(start, lastDecoded + 1) as IndexedFrame[],
      shown: shown.map((decoded) => ({
        pts: ptsOf(decoded),
        playedSeconds: playedFromSeconds + Math.max(0, ptsOf(decoded) / timescale - recordingFromSeconds),
      })),
    };
  });
}
