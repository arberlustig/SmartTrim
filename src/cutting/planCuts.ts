/** Frames per second as an exact ratio, e.g. 30000/1001 for 29.97. Always probed from the Recording. */
export interface FrameRate {
  numerator: number;
  denominator: number;
}

/** A stretch of the Recording in seconds; end is exclusive. */
export interface TimeRange {
  startSeconds: number;
  endSeconds: number;
}

export interface CutInput {
  recording: {
    durationFrames: number;
    frameRate: FrameRate;
  };
  /** Stretches where any Voice track carries speech. */
  speech: readonly TimeRange[];
  /** ContentEvents found on Content tracks. */
  contentEvents: readonly TimeRange[];
  /** LockedRanges the user marked; kept with exact edges, no Margin. */
  lockedRanges: readonly TimeRange[];
  /** Kept on each side of speech. */
  marginSeconds: number;
  /** EventLead: kept before each ContentEvent, in place of Margin. */
  eventLeadSeconds: number;
  /** EventTail: kept after each ContentEvent, in place of Margin. */
  eventTailSeconds: number;
  /** ADR-0007: measured after Margin, EventLead and EventTail are kept. */
  minimumDeadZoneSeconds: number;
}

/**
 * All positions are whole frames at the Recording's frame rate.
 * `recordingOut` and `timelineEnd` are exclusive, matching FCP7 `out` and `end`.
 */
export interface KeepSegment {
  recordingIn: number;
  recordingOut: number;
  timelineStart: number;
  timelineEnd: number;
}

/** Ordered KeepSegments; timeline positions are contiguous. */
export type CutPlan = readonly KeepSegment[];

// Floating-point noise stays around 1e-9 frames even hours into a Recording, while one 16 kHz
// sample is more than 0.001 frames at any real frame rate — so this only ever catches noise.
const FRAME_EPSILON = 1e-6;

function snapToWholeFrame(frames: number): number {
  const nearest = Math.round(frames);
  return Math.abs(frames - nearest) < FRAME_EPSILON ? nearest : frames;
}

export function planCuts(input: CutInput): CutPlan {
  const { durationFrames, frameRate } = input.recording;
  const toFrames = (seconds: number) =>
    snapToWholeFrame((seconds * frameRate.numerator) / frameRate.denominator);

  const padded: TimeRange[] = [
    ...input.speech.map((range) => ({
      startSeconds: range.startSeconds - input.marginSeconds,
      endSeconds: range.endSeconds + input.marginSeconds,
    })),
    ...input.contentEvents.map((event) => ({
      startSeconds: event.startSeconds - input.eventLeadSeconds,
      endSeconds: event.endSeconds + input.eventTailSeconds,
    })),
    // Exact edges: nothing is added around a LockedRange.
    ...input.lockedRanges,
  ].sort((a, b) => a.startSeconds - b.startSeconds);

  // ADR-0007: Margin, EventLead and EventTail are kept first, then only what remains is
  // measured against the MinimumDeadZone.
  const kept: TimeRange[] = [];
  for (const { startSeconds, endSeconds } of padded) {
    const previous = kept.at(-1);
    if (previous && startSeconds - previous.endSeconds < input.minimumDeadZoneSeconds) {
      previous.endSeconds = Math.max(previous.endSeconds, endSeconds);
    } else {
      kept.push({ startSeconds, endSeconds });
    }
  }

  const first = kept[0];
  if (first && first.startSeconds < input.minimumDeadZoneSeconds) {
    first.startSeconds = 0;
  }

  const durationSeconds = (durationFrames * frameRate.denominator) / frameRate.numerator;
  const last = kept.at(-1);
  if (last && durationSeconds - last.endSeconds < input.minimumDeadZoneSeconds) {
    last.endSeconds = durationSeconds;
  }

  let timelinePosition = 0;
  return kept.map((range) => {
    // Widen to whole frames: a frame too many is better than clipped speech.
    const recordingIn = Math.max(0, Math.floor(toFrames(range.startSeconds)));
    const recordingOut = Math.min(durationFrames, Math.ceil(toFrames(range.endSeconds)));
    const timelineStart = timelinePosition;
    timelinePosition += recordingOut - recordingIn;
    return { recordingIn, recordingOut, timelineStart, timelineEnd: timelinePosition };
  });
}
