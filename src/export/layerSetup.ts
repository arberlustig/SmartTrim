import type { PremierePreset } from "./premierePreset.ts";
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
