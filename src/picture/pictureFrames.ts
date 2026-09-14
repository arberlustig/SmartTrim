import { spawn, type ChildProcess } from "node:child_process";
import { constants, setPriority } from "node:os";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import { LONGEST_EXCERPT_SECONDS } from "../playback/playback.ts";

/** How high every frame is made, in pixels: the picture is drawn at most 450 px high (ADR-0027). */
export const PICTURE_HEIGHT = 450;

/**
 * How much memory the frames may take. The owner allowed the picture 2 GB; three minutes of their Recordings are
 * 340–600 MB of frames, so this holds the stretch wished for and a few places clicked before it (ADR-0028).
 */
export const PICTURE_BUDGET_BYTES = 1024 ** 3;

/** ffmpeg's MJPEG quality, 2 (best) to 31. 8 measured 110–150 MB per minute of the owner's Recordings at 800×450. */
const JPEG_QUALITY = 8;

/**
 * Threads for one ffmpeg making frames. With ffmpeg's own choice the Excerpt read beside it slowed down enough to make
 * the sound come 245 ms later than without a picture; below-normal priority and 4 threads, 155 ms (ADR-0028).
 */
const FFMPEG_THREADS = 4;

/** How many runs `runs()` remembers. */
const RUNS_KEPT = 200;

/** A decoder on the graphics card and the filter that scales on it before the frames come down. */
export interface HardwareDecoder {
  hwaccel: string;
  scale: (width: number, height: number) => string;
}

/** NVIDIA's decoder: the owner's machine made 1300–1500 frames a second with it, twice what the processor makes. */
export const CUDA: HardwareDecoder = {
  hwaccel: "cuda",
  scale: (width, height) => `scale_cuda=${width}:${height},hwdownload,format=nv12`,
};

export interface PictureFramesOptions {
  /** How high every frame is made. */
  height?: number;
  /** How much picture one wish makes, from the moment wished for. */
  wantSeconds?: number;
  /** How many bytes of frames may be held before the ones farthest from the stretch wished for are let go. */
  budgetBytes?: number;
  /** The graphics card's decoder to try first; null decodes on the processor from the start. */
  hardware?: HardwareDecoder | null;
}

/** One ffmpeg asked for frames: what it was asked for and how far it got. */
export interface PictureRun {
  /** The first frame asked for. */
  fromFrame: number;
  /** The frame after the last one asked for. */
  toFrame: number;
  made: number;
  running: boolean;
  /** Ended by SmartTrim because it was no longer wanted, not because it was done. */
  stopped: boolean;
  onProcessor: boolean;
  /** How long until its first frame arrived, and until it ended. */
  firstFrameMs: number | null;
  ms: number | null;
}

/**
 * The picture of one Recording as small JPEG frames, made ahead by ffmpeg and held in memory by frame number, so the
 * window can draw the frame due at any moment of what is played without seeking (ADR-0028). Frame k is the frame on
 * screen at k / fps of the Recording.
 */
export interface PictureFrames {
  /**
   * Asks for the frames from `fromSeconds` of `recording` onwards, as far as `wantSeconds`. Returns at once; ffmpeg
   * works in the background on the first frames still missing, and a run heading elsewhere is stopped. Another
   * Recording than the one held lets go of everything held.
   */
  want(recording: RecordingInfo, fromSeconds: number): void;
  /** The JPEGs of these frames of `recording`, null for each one not made yet. */
  frames(recording: RecordingInfo, indices: readonly number[]): (Uint8Array | null)[];
  /** How many bytes of frames are held. */
  heldBytes(): number;
  /** The latest runs of ffmpeg, oldest first — what the measuring scripts read. */
  runs(): readonly PictureRun[];
  /** Stops ffmpeg and lets go of every frame. */
  stop(): void;
}

interface Run {
  child: ChildProcess;
  record: PictureRun;
}

interface Held {
  recording: RecordingInfo;
  frames: Map<number, Buffer>;
  bytes: number;
  wanted: { from: number; end: number } | null;
  run: Run | null;
  onProcessor: boolean;
  /** Runs in a row that brought nothing, so a stretch ffmpeg cannot give is not asked for without end. */
  emptyRuns: number;
}

/** Where the JPEG starting at `start` ends, or -1 while it has not arrived whole. */
function jpegEnd(buffer: Buffer, start: number): number {
  let at = start + 2;
  while (at + 2 <= buffer.length) {
    if (buffer[at] !== 0xff) throw new Error(`ffmpeg wrote something that is not a JPEG (byte ${at}).`);
    const marker = buffer[at + 1] as number;
    if (marker === 0xd9) return at + 2;
    if (at + 4 > buffer.length) return -1;
    const length = buffer.readUInt16BE(at + 2);
    if (marker !== 0xda) {
      at += 2 + length;
      continue;
    }
    // The coded picture: a 0xFF inside it is followed by 0x00 or a restart marker, anything else ends it. Searched with
    // indexOf: a loop over the bytes stalled the main process at 1400 frames a second.
    let scan = at + 2 + length;
    for (;;) {
      scan = buffer.indexOf(0xff, scan);
      if (scan < 0 || scan + 1 >= buffer.length) return -1;
      const next = buffer[scan + 1] as number;
      if (next !== 0 && (next < 0xd0 || next > 0xd7)) break;
      scan += 1;
    }
    at = scan;
  }
  return -1;
}

export function newPictureFrames(ffmpegPath: string, options: PictureFramesOptions = {}): PictureFrames {
  const height = options.height ?? PICTURE_HEIGHT;
  const wantSeconds = options.wantSeconds ?? LONGEST_EXCERPT_SECONDS;
  const budgetBytes = options.budgetBytes ?? PICTURE_BUDGET_BYTES;
  const hardware = options.hardware === undefined ? CUDA : options.hardware;
  const runs: PictureRun[] = [];
  let held: Held | null = null;

  function stopRun(holding: Held): void {
    if (!holding.run) return;
    holding.run.record.stopped = true;
    holding.run.child.kill();
    holding.run = null;
  }

  /**
   * Lets go of frames outside the stretch wished for, farthest from it first, until a tenth of the limit is free again
   * — so the sorting happens once in a while rather than for every frame that arrives.
   */
  function makeRoom(holding: Held): void {
    const { wanted } = holding;
    if (!wanted) return;
    const distanceOf = (index: number) => (index < wanted.from ? wanted.from - index : index - wanted.end + 1);
    const outside = [...holding.frames.keys()].filter((index) => index < wanted.from || index >= wanted.end);
    outside.sort((a, b) => distanceOf(b) - distanceOf(a));
    for (const index of outside) {
      if (holding.bytes <= budgetBytes * 0.9) break;
      holding.bytes -= (holding.frames.get(index) as Buffer).length;
      holding.frames.delete(index);
    }
  }

  function keep(holding: Held, index: number, jpeg: Buffer): void {
    holding.bytes += jpeg.length - (holding.frames.get(index)?.length ?? 0);
    holding.frames.set(index, jpeg);
    if (holding.bytes > budgetBytes) makeRoom(holding);
  }

  /** Puts ffmpeg to work on the first frame still missing from what is wanted, unless a run already heads there. */
  function ensure(holding: Held): void {
    if (!holding.wanted) return;
    const { from, end } = holding.wanted;
    let missing = from;
    while (missing < end && holding.frames.has(missing)) missing += 1;
    if (missing >= end) {
      stopRun(holding);
      return;
    }
    const perSecond = holding.recording.frameRate.numerator / holding.recording.frameRate.denominator;
    const running = holding.run?.record;
    // A run that is about to reach the first missing frame — within a second — is left to get there.
    if (running && running.fromFrame <= missing && missing <= running.fromFrame + running.made + perSecond) return;
    stopRun(holding);
    let stop = missing;
    while (stop < end && !holding.frames.has(stop)) stop += 1;
    start(holding, missing, stop);
  }

  function start(holding: Held, fromFrame: number, toFrame: number): void {
    const { recording } = holding;
    const { numerator, denominator } = recording.frameRate;
    // ffmpeg keeps the first frame whose time is not before -ss, so the frame's own time is rounded down to a microsecond.
    const seconds = Math.floor(((fromFrame * denominator) / numerator) * 1e6) / 1e6;
    const width = Math.round((height * recording.width) / recording.height / 2) * 2;
    const decoder = holding.onProcessor ? null : hardware;
    const startedAt = performance.now();
    const child = spawn(
      ffmpegPath,
      [
        ...["-hide_banner", "-loglevel", "error", "-nostdin"],
        ...(decoder ? ["-hwaccel", decoder.hwaccel, "-hwaccel_output_format", decoder.hwaccel] : []),
        ...["-ss", seconds.toFixed(6), "-i", recording.path, "-map", "0:v:0", "-frames:v", String(toFrame - fromFrame)],
        ...["-vf", decoder ? decoder.scale(width, height) : `scale=${width}:${height}`],
        ...["-pix_fmt", "yuvj420p", "-c:v", "mjpeg", "-q:v", String(JPEG_QUALITY), "-threads", String(FFMPEG_THREADS)],
        ...["-f", "image2pipe", "-"],
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // The frames still come, only with the sound read beside them a little slower.
      }
    }
    const record: PictureRun = {
      fromFrame,
      toFrame,
      made: 0,
      running: true,
      stopped: false,
      onProcessor: decoder === null,
      firstFrameMs: null,
      ms: null,
    };
    runs.push(record);
    if (runs.length > RUNS_KEPT) runs.splice(0, runs.length - RUNS_KEPT);
    holding.run = { child, record };

    let pending: Buffer = Buffer.alloc(0);
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let at = 0;
      for (let end = jpegEnd(pending, at); end >= 0; end = jpegEnd(pending, at)) {
        if (!record.stopped) keep(holding, fromFrame + record.made, Buffer.from(pending.subarray(at, end)));
        record.firstFrameMs ??= Math.round(performance.now() - startedAt);
        record.made += 1;
        at = end;
      }
      if (at > 0) pending = pending.subarray(at);
    });
    child.on("error", () => {
      // A missing ffmpeg is reported by "close" with no frames made.
    });
    child.on("close", (code) => {
      record.running = false;
      record.ms = Math.round(performance.now() - startedAt);
      if (holding.run?.record === record) holding.run = null;
      if (record.stopped || held !== holding) return;
      if (record.made > 0) {
        holding.emptyRuns = 0;
      } else {
        holding.emptyRuns += 1;
        // Nothing came out. A graphics card that failed gets one more try on the processor; anything else stops asking
        // after three empty runs in a row.
        if (!holding.onProcessor && decoder && (code !== 0 || errors)) holding.onProcessor = true;
        else if (holding.emptyRuns >= 3) {
          holding.wanted = null;
          return;
        }
      }
      ensure(holding);
    });
  }

  return {
    want(recording, fromSeconds) {
      if (held && held.recording.path !== recording.path) this.stop();
      held ??= { recording, frames: new Map(), bytes: 0, wanted: null, run: null, onProcessor: false, emptyRuns: 0 };
      const perSecond = recording.frameRate.numerator / recording.frameRate.denominator;
      const from = Math.min(Math.max(Math.floor(fromSeconds * perSecond + 1e-6), 0), recording.durationFrames - 1);
      held.wanted = { from, end: Math.min(from + Math.round(wantSeconds * perSecond), recording.durationFrames) };
      held.emptyRuns = 0;
      ensure(held);
    },

    frames(recording, indices) {
      const holding = held && held.recording.path === recording.path ? held : null;
      return indices.map((index) => holding?.frames.get(index) ?? null);
    },

    heldBytes() {
      return held?.bytes ?? 0;
    },

    runs() {
      return runs;
    },

    stop() {
      if (held) stopRun(held);
      held = null;
    },
  };
}
