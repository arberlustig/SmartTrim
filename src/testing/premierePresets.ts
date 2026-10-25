import type { VideoLayer } from "../export/layerSetup.ts";
import type { PremierePreset } from "../export/premierePreset.ts";

// For tests only. Two of the owner's PremierePresets as SmartTrim keeps them, written out by hand with round values;
// the reader's own output from fixtures/premiere/video-layers/ carries what Premiere stored to the last digit.

/** RAWCUT - V1: the game half moved into the frame. */
export const RAW_V1: PremierePreset = {
  name: "RAWCUT - V1",
  motion: { position: { x: 1, y: 0.5 }, scale: 100, anchor: { x: 0.5, y: 0.5 } },
  crop: undefined,
  transformScale: 100,
  carried: ["Bewegung"],
  notCarried: [],
};

/** RAWCUT - V2: the facecam cropped and shrunk, its rough edges and shadows left behind. */
export const RAW_V2: PremierePreset = {
  name: "RAWCUT - V2",
  motion: { position: { x: -0.15625, y: 0.5185185 }, scale: 100, anchor: { x: 0.5, y: 0.5 } },
  crop: { left: 61, top: 0, right: 11, bottom: 0 },
  transformScale: 90,
  carried: ["Zuschneiden", "Transformieren", "Bewegung"],
  notCarried: [{ effect: "Kanten aufrauen" }, { effect: "Schlagschatten" }, { effect: "Schlagschatten" }],
};

/** A VideoLayer as "+ Videospur" adds it. */
export const PLAIN_LAYER: VideoLayer = { clipPremierePreset: undefined, nestPremierePreset: undefined, startsSwitchedOff: false };
