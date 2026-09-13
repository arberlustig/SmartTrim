import type { TimeRange } from "../cutting/planCuts.ts";
import type { MonoPcm } from "../speech/detectSpeech.ts";
import { CHUNK_SAMPLES, SAMPLE_RATE, chunkLevelsDbfs, type ChunkLevels } from "./detectLoudness.ts";

/** How a ContentEvent is told apart from a SourceTrack's own background. */
export interface ContentEventOptions {
  /** How far above its recent baseline a moment has to jump: an explosion, a fanfare. */
  riseDb?: number;
  /** How far below the baseline it has to fall: music or a game cutting out. */
  dropDb?: number;
  /** The stretch whose middle level counts as the baseline — the SourceTrack's own recent past. */
  baselineSeconds?: number;
  /** Shorter departures are clicks and crackle, not moments. */
  minimumEventSeconds?: number;
}

/**
 * Provisional until measured on the owner's own Recordings: a 12 dB jump is about how much louder an explosion is
 * than the game under it, and five seconds of baseline is short enough to follow a scene and long enough that one
 * bang does not become the new normal.
 */
const DEFAULTS = { riseDb: 12, dropDb: 15, baselineSeconds: 5, minimumEventSeconds: 0.1 } as const;

/**
 * The levels of the baseline window, kept sorted, so its middle value is read off in one step. The middle value is
 * what makes a baseline: one loud chunk cannot drag it the way it would drag an average, so a bang does not become
 * the new normal — but a minute of banging does.
 */
class SortedLevels {
  private readonly sorted: number[] = [];

  private find(level: number): number {
    let low = 0;
    let high = this.sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.sorted[middle] as number) < level) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  add(level: number): void {
    this.sorted.splice(this.find(level), 0, level);
  }

  remove(level: number): void {
    this.sorted.splice(this.find(level), 1);
  }

  middle(): number {
    const { sorted } = this;
    if (sorted.length === 0) return -Infinity;
    const middle = sorted.length >> 1;
    return sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  }
}

/**
 * Finds the moments where a Content SourceTrack departs noticeably from its own recent baseline — an explosion, a
 * fanfare, an abrupt drop (CONTEXT.md). Continuous background audio is never one, however loud: the baseline is the
 * SourceTrack's own recent past, so a Recording that is loud from end to end holds no events.
 *
 * The baseline is the median level of the preceding `baselineSeconds`, which is why nothing can be judged in the
 * first such stretch of a Recording: there is no recent past to compare it with yet.
 */
export function detectContentEvents(audio: MonoPcm, options: ContentEventOptions = {}): TimeRange[] {
  if (audio.sampleRate !== SAMPLE_RATE) {
    throw new Error(`Content events need ${SAMPLE_RATE} Hz audio; this audio is ${audio.sampleRate} Hz.`);
  }
  return contentEventsFrom({ levelsDbfs: Float64Array.from(chunkLevelsDbfs(audio)) }, options);
}

/**
 * The same moments found from a SourceTrack's kept chunk levels instead of its audio — the levels are all the
 * search reads. SmartTrim keeps the levels for the session and lets the audio go (ADR-0021).
 */
export function contentEventsFrom(chunkLevels: ChunkLevels, options: ContentEventOptions = {}): TimeRange[] {
  const { riseDb, dropDb, baselineSeconds, minimumEventSeconds } = { ...DEFAULTS, ...options };
  const levels = chunkLevels.levelsDbfs;
  const chunksPerSecond = SAMPLE_RATE / CHUNK_SAMPLES;
  const baselineChunks = Math.max(1, Math.round(baselineSeconds * chunksPerSecond));
  const minimumChunks = Math.max(1, Math.round(minimumEventSeconds * chunksPerSecond));

  // Every chunk is judged against the window that ends just before it, so the baseline follows the SourceTrack
  // chunk by chunk. Nothing is judged in the first window: there is no recent past to compare it with yet.
  const departs = new Uint8Array(levels.length);
  const window = new SortedLevels();
  for (let chunk = 0; chunk < levels.length; chunk++) {
    const level = levels[chunk] as number;
    if (chunk >= baselineChunks) {
      const baseline = window.middle();
      const rose = level >= baseline + riseDb;
      // A baseline of digital silence has nothing to fall below, so only a rise counts there.
      const fell = baseline > -Infinity && level <= baseline - dropDb;
      departs[chunk] = rose || fell ? 1 : 0;
      window.remove(levels[chunk - baselineChunks] as number);
    }
    window.add(level);
  }

  const events: TimeRange[] = [];
  let runStart = -1;
  for (let chunk = 0; chunk <= departs.length; chunk++) {
    const departing = chunk < departs.length && departs[chunk] === 1;
    if (departing && runStart < 0) runStart = chunk;
    if (!departing && runStart >= 0) {
      if (chunk - runStart >= minimumChunks) {
        events.push({ startSeconds: runStart / chunksPerSecond, endSeconds: chunk / chunksPerSecond });
      }
      runStart = -1;
    }
  }
  return events;
}
