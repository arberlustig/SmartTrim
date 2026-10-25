import type { PremierePreset, UncarriedParameter } from "./premierePreset.ts";
import type { FrameSize } from "./videoLayerMotion.ts";

/** One VideoLayer of a LayerSetup, V1 first (ADR-0033). */
export interface VideoLayer {
  /** On the one clip of the whole Recording inside the VideoLayer's Nest. */
  clipPremierePreset: PremierePreset | undefined;
  /** On every piece of the Nest on the timeline. */
  nestPremierePreset: PremierePreset | undefined;
  /** Whether the VideoLayer's piece of every KeepSegment starts switched off. */
  startsSwitchedOff: boolean;
}

/**
 * Whether the VideoLayers make a LayerSetup. V1 is always there; it takes more than V1, or a PremierePreset or the
 * tick on V1. Without a LayerSetup the export stays exactly as it was before VideoLayers existed.
 */
export function isLayerSetup(videoLayers: readonly VideoLayer[]): boolean {
  const [v1, ...more] = videoLayers;
  if (!v1) return false;
  if (more.length > 0) return true;
  return v1.clipPremierePreset !== undefined || v1.nestPremierePreset !== undefined || v1.startsSwitchedOff;
}

/**
 * The exact reduced width:height of a frame, the key a LayerSetup is remembered under: 3840x1080 and 5120x1440 are
 * both "32:9". Two frames sold under one name ("21:9") can have different keys.
 */
export function aspectRatioOf({ width, height }: FrameSize): string {
  const greatestCommonDivisor = (a: number, b: number): number => (b === 0 ? a : greatestCommonDivisor(b, a % b));
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/**
 * The frame of the exported sequence, and of every Nest in it. The PremierePresets are built for 16:9, so a
 * LayerSetup on a Recording wider than that makes it 16:9 at the probed height, the width rounded to an even number.
 */
export function sequenceFrameFor(recording: FrameSize, videoLayers: readonly VideoLayer[]): FrameSize {
  const widerThan16x9 = recording.width * 9 > recording.height * 16;
  if (!isLayerSetup(videoLayers) || !widerThan16x9) return recording;
  return { width: Math.round((recording.height * 16) / 9 / 2) * 2, height: recording.height };
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isPoint = (value: unknown) => isRecord(value) && isNumber(value["x"]) && isNumber(value["y"]);
const isStringArray = (value: unknown) => Array.isArray(value) && value.every((each) => typeof each === "string");
/** The parameters the window has words for (ADR-0030); any other would reach it as a bare code. */
const UNCARRIED_PARAMETERS: readonly UncarriedParameter[] = ["motionAntiFlicker", "motionCrop", "cropZoom", "cropEdgeFeather"];

/** Whether a value read from a file is a whole PremierePreset as SmartTrim saves it. */
export function isPremierePreset(value: unknown): value is PremierePreset {
  if (!isRecord(value) || typeof value["name"] !== "string" || !isNumber(value["transformScale"])) return false;
  const motion = value["motion"];
  const crop = value["crop"];
  const notCarried = value["notCarried"];
  return (
    isRecord(motion) &&
    isPoint(motion["position"]) &&
    isNumber(motion["scale"]) &&
    isPoint(motion["anchor"]) &&
    (crop === undefined || (isRecord(crop) && ["left", "top", "right", "bottom"].every((side) => isNumber(crop[side])))) &&
    isStringArray(value["carried"]) &&
    Array.isArray(notCarried) &&
    notCarried.every(
      (each) =>
        isRecord(each) &&
        typeof each["effect"] === "string" &&
        (each["parameter"] === undefined || UNCARRIED_PARAMETERS.includes(each["parameter"] as UncarriedParameter)),
    )
  );
}

/**
 * Reads VideoLayers saved in a file (a TrimProject, the remembered LayerSetups), or null when they are damaged. JSON
 * leaves out a place that holds no PremierePreset; it comes back as one that holds none.
 */
export function videoLayersFrom(value: unknown): VideoLayer[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const layers: VideoLayer[] = [];
  for (const each of value) {
    if (!isRecord(each) || typeof each["startsSwitchedOff"] !== "boolean") return null;
    const clip = each["clipPremierePreset"];
    const nest = each["nestPremierePreset"];
    if ((clip !== undefined && !isPremierePreset(clip)) || (nest !== undefined && !isPremierePreset(nest))) return null;
    layers.push({ clipPremierePreset: clip, nestPremierePreset: nest, startsSwitchedOff: each["startsSwitchedOff"] });
  }
  return layers;
}
