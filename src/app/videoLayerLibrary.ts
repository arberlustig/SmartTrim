import { isLayerSetup, isPremierePreset, videoLayersFrom, type VideoLayer } from "../export/layerSetup.ts";
import type { PremierePreset } from "../export/premierePreset.ts";

/**
 * The format number of the library file, raised whenever a field is added that an older SmartTrim would drop. A file
 * from a newer version is refused rather than half read: saving over it would throw away what this one cannot see.
 */
const FORMAT = 1;

/**
 * What SmartTrim keeps about VideoLayers between starts (ADR-0033): the PremierePresets the user added, and the last
 * LayerSetup for each aspect ratio. One file, beside the own Presets but not in theirs, so that a field added here
 * never locks an older SmartTrim out of the user's Presets (ADR-0018).
 */
export interface VideoLayerLibrary {
  premierePresets: readonly PremierePreset[];
  /** By aspect ratio as `aspectRatioOf` spells it, "32:9". */
  layerSetups: Readonly<Record<string, readonly VideoLayer[]>>;
}

export const EMPTY_LIBRARY: VideoLayerLibrary = { premierePresets: [], layerSetups: {} };

/** Writes the library as the text of its file. */
export function libraryText(library: VideoLayerLibrary): string {
  // The format comes first so the file says what it is in its first line, as a `.smarttrim` project does.
  return JSON.stringify({ smarttrimVideoLayers: FORMAT, ...library }, undefined, 1);
}

/**
 * Reads the text of the library file. Text that is not one — torn off mid-write, or something else entirely — reads
 * as an empty library: nothing in it can be rescued. A file that is one but whose contents are wrong is refused, as
 * the preset file is, because saving over it would destroy what the user added (ADR-0018).
 */
export function readLibrary(text: string): VideoLayerLibrary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_LIBRARY;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY_LIBRARY;
  const file = parsed as Record<string, unknown>;
  const format = file["smarttrimVideoLayers"];
  if (typeof format !== "number") return EMPTY_LIBRARY;
  if (format > FORMAT) {
    throw new Error(`These video layers come from a newer SmartTrim (format ${format}; this one reads ${FORMAT}).`);
  }
  const premierePresets = file["premierePresets"];
  if (!Array.isArray(premierePresets) || !premierePresets.every(isPremierePreset)) {
    throw new Error("The saved Premiere presets are damaged.");
  }
  const saved = file["layerSetups"];
  if (typeof saved !== "object" || saved === null) throw new Error("The remembered video layers are damaged.");
  const layerSetups: Record<string, readonly VideoLayer[]> = {};
  for (const [aspectRatio, value] of Object.entries(saved)) {
    const videoLayers = videoLayersFrom(value);
    if (!videoLayers) throw new Error(`The video layers remembered for ${aspectRatio} are damaged.`);
    layerSetups[aspectRatio] = videoLayers;
  }
  return { premierePresets, layerSetups };
}

/**
 * Adds PremierePresets, as read from one `.prfpset` file. A name already there is replaced where it stands, so
 * adding a file twice leaves one of each and does not reorder the list under the user's cursor.
 */
export function withPremierePresets(library: VideoLayerLibrary, added: readonly PremierePreset[]): VideoLayerLibrary {
  let premierePresets = [...library.premierePresets];
  for (const premierePreset of added) {
    const at = premierePresets.findIndex((each) => each.name === premierePreset.name);
    premierePresets =
      at === -1
        ? [...premierePresets, premierePreset]
        : premierePresets.map((each, position) => (position === at ? premierePreset : each));
  }
  return { ...library, premierePresets };
}

/**
 * Takes a PremierePreset out of the list. LayerSetups that use it keep their own copy, so no Tab, remembered
 * LayerSetup or saved project loses it; the user's `.prfpset` file is never touched.
 */
export function withoutPremierePreset(library: VideoLayerLibrary, name: string): VideoLayerLibrary {
  return { ...library, premierePresets: library.premierePresets.filter((each) => each.name !== name) };
}

/** Remembers the LayerSetup of one aspect ratio. V1 alone and plain is no LayerSetup and is remembered as none. */
export function withLayerSetupRemembered(
  library: VideoLayerLibrary,
  aspectRatio: string,
  videoLayers: readonly VideoLayer[],
): VideoLayerLibrary {
  const { [aspectRatio]: _forgotten, ...others } = library.layerSetups;
  return { ...library, layerSetups: isLayerSetup(videoLayers) ? { ...others, [aspectRatio]: [...videoLayers] } : others };
}

/** The LayerSetup a new Tab of this aspect ratio starts with, or undefined when there is none. */
export function rememberedVideoLayers(library: VideoLayerLibrary, aspectRatio: string): readonly VideoLayer[] | undefined {
  return library.layerSetups[aspectRatio];
}
