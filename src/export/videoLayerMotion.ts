import type { PremierePreset } from "./premierePreset.ts";

/** A picture's size in pixels. */
export interface FrameSize {
  width: number;
  height: number;
}

/**
 * FCP7's Basic Motion as Premiere reads it. The centre is where the clip's centre lands, measured from the middle of
 * the frame the clip sits in, in units of the clip's own unscaled frame; SmartTrim always writes the anchor at the
 * clip centre, so there is no centerOffset to carry (ADR-0033).
 */
export interface BasicMotion {
  /** Percent. */
  scale: number;
  center: { horiz: number; vert: number };
}

/**
 * The Basic Motion a clip gets from a PremierePreset: `sitsIn` is the frame the clip is placed in (the sequence, or
 * the Nest for the clip inside it), `clip` the clip's own frame (the Recording, or the Nest). A clip without one is
 * still written centred at 100 %, so Premiere's media-scaling preference cannot step in.
 */
export function basicMotionFor(
  premierePreset: PremierePreset | undefined,
  sitsIn: FrameSize,
  clip: FrameSize,
): BasicMotion {
  if (!premierePreset) return { scale: 100, center: { horiz: 0, vert: 0 } };
  const { position, anchor, scale } = premierePreset.motion;
  return {
    // A folded Transform scales around the clip centre before Motion, so it changes the size but not where the
    // centre lands: it enters the scale only, never the anchor term below.
    scale: (scale * premierePreset.transformScale) / 100,
    center: {
      horiz: (position.x * sitsIn.width - sitsIn.width / 2) / clip.width + (0.5 - anchor.x) * (scale / 100),
      vert: (position.y * sitsIn.height - sitsIn.height / 2) / clip.height + (0.5 - anchor.y) * (scale / 100),
    },
  };
}
