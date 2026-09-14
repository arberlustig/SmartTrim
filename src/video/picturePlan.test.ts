import { describe, expect, test } from "vitest";
import { picturePlanOf, stillFrameOf, type PiecePicture } from "./picturePlan";
import type { VideoIndex } from "./videoIndex";

/**
 * An index of a picture at 60 ticks a second, one tick a frame as OBS writes it, from each frame's display tick in
 * decode order; "K" marks a keyframe. Every frame gets a place of its own in the file.
 */
function indexFrom(decodeOrder: string): VideoIndex {
  return {
    timescale: 60,
    frames: decodeOrder.split(" ").map((entry, decoded) => ({
      pts: Number(entry.replace("K", "")),
      dts: decoded,
      position: 1000 * decoded,
      size: 1000,
      key: entry.startsWith("K"),
    })),
    decoder: { codec: "hvc1.1.6.L123.90", description: new Uint8Array() },
  };
}

// Three groups of six frames. In each, a P-frame is decoded ahead of the B-frames shown before it.
const index = indexFrom("K0 3 1 2 5 4 K6 9 7 8 11 10 K12 15 13 14 17 16");

/** What goes on screen, played moments to the microsecond. */
function onScreen(plan: PiecePicture | undefined) {
  return plan?.shown.map(({ pts, playedSeconds }) => ({ pts, playedMicroseconds: Math.round(playedSeconds * 1e6) }));
}

describe("picturePlanOf", () => {
  // The piece runs from half a frame into frame 8 to the start of frame 10. Frame 8 is on screen at its first moment,
  // so it shows from there. It is a B-frame: decoding starts at keyframe 6 and needs P-frame 9 and B-frame 7, which
  // come before it; P-frame 11 and B-frame 10 come after and show nothing of the piece.
  test("a piece decodes from the keyframe before it and shows the frame on screen at its start from its first moment", () => {
    const [plan] = picturePlanOf(index, [
      { recordingFromSeconds: 8.5 / 60, recordingToSeconds: 10 / 60, playedFromSeconds: 2 },
    ]);

    expect(plan?.feed.map((frame) => frame.pts)).toEqual([6, 9, 7, 8]);
    expect(onScreen(plan)).toEqual([
      { pts: 8, playedMicroseconds: 2_000_000 },
      { pts: 9, playedMicroseconds: 2_008_333 },
    ]);
  });

  // HEVC lets frames decoded after a keyframe be shown before it (an open group): here 6, 5 and 7 come after
  // keyframe 8 and are built from frame 4 before it as well. The piece shows 6 and 7, so decoding runs from keyframe 0
  // past keyframe 8. Searching only up to the first keyframe after the piece would put frame 4 on screen instead.
  test("frames shown before a keyframe but decoded after it are found and decoded from the keyframe before", () => {
    const openGroups = indexFrom("K0 4 2 1 3 K8 6 5 7 12 10 9 11 K16 14 13 15");

    const [plan] = picturePlanOf(openGroups, [
      { recordingFromSeconds: 6.5 / 60, recordingToSeconds: 7.5 / 60, playedFromSeconds: 0 },
    ]);

    expect(plan?.feed.map((frame) => frame.pts)).toEqual([0, 4, 2, 1, 3, 8, 6, 5, 7]);
    expect(onScreen(plan)).toEqual([
      { pts: 6, playedMicroseconds: 0 },
      { pts: 7, playedMicroseconds: 8_333 },
    ]);
  });
});

describe("stillFrameOf", () => {
  // A click puts the Playhead a fifth of a frame into frame 10. Frame 10 is the last B-frame of its group: it is
  // decoded after P-frame 11, which shows later but is one of the frames it is built from.
  test("the still frame is the frame on screen at the moment, decoded from its keyframe up to itself", () => {
    const still = stillFrameOf(index, 10.2 / 60);

    expect({ feed: still.feed.map((frame) => frame.pts), pts: still.pts }).toEqual({ feed: [6, 9, 7, 8, 11, 10], pts: 10 });
  });
});
