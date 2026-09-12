import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { sourceTrackLevelsFromAstats } from "./scanSourceTracks";

/** ffmpeg's own output for one 10 s slice of a real six-SourceTrack OBS Recording. Only its path was replaced. */
const slice = readFileSync(
  fileURLToPath(new URL("../../fixtures/astats/obs-6-sourcetracks-slice.txt", import.meta.url)),
  "utf8",
);

describe("sourceTrackLevelsFromAstats", () => {
  // ffmpeg prints the filters in whatever order they finish — this slice reports SourceTrack 1, then 6, 5, 4, 3, 2.
  // Reading them in the order they appear would hand SourceTrack 2's silence to SourceTrack 6, and the window would
  // hide the track the owner speaks on. The numbers below are what ffmpeg measured on that Recording.
  test("reads a level for every SourceTrack, however ffmpeg ordered its output", () => {
    const levels = sourceTrackLevelsFromAstats(slice, 6);

    expect(levels).toEqual([
      { peakDbfs: -0.457506, rmsDbfs: -20.818519 },
      { peakDbfs: -Infinity, rmsDbfs: -Infinity },
      { peakDbfs: -38.748844, rmsDbfs: -57.709075 },
      { peakDbfs: -Infinity, rmsDbfs: -Infinity },
      { peakDbfs: -0.146304, rmsDbfs: -20.810727 },
      { peakDbfs: -0.146304, rmsDbfs: -20.810727 },
    ]);
  });

  // Silence and "ffmpeg told us nothing" look the same in a Map and mean opposite things: one hides a dead track,
  // the other would hide a track that carries the voice.
  test("a SourceTrack ffmpeg measured nothing for is refused, not read as silence", () => {
    expect(() => sourceTrackLevelsFromAstats(slice, 7)).toThrow("ffmpeg measured no level for SourceTrack 7.");
  });
});
