import { spawn, type ChildProcess } from "node:child_process";
import { constants, setPriority } from "node:os";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import { LONGEST_EXCERPT_SECONDS } from "../playback/playback.ts";
import { PICTURE_HEIGHT, frameAtSeconds, lastPictureFrameOf, pictureRateOf, pictureSizeOf } from "./framesDue.ts";

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

/** Refusals of the graphics card in a row after which it is not asked again for this Recording. */
const HARDWARE_REFUSALS_BELIEVED = 3;

/** Runs in a row that bring no frame before a wish is given up and reported. */
const EMPTY_RUNS_BELIEVED = 3;

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

/** How a PictureFrames makes its frames. Left out, each takes the value SmartTrim uses; the tests shrink them. */
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
  /** The first picture frame asked for. */
  fromFrame: number;
  /** The picture frame after the last one asked for. */
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
 * The picture of one Recording as small JPEG frames, made ahead by ffmpeg and held in memory by number, so the window
 * can draw the frame due at any moment of what is played without seeking (ADR-0028). Frame numbers count the picture's
 * own frames, which are the Recording's up to 60 frames a second (`pictureRateOf`).
 */
export interface PictureFrames {
  /**
   * Asks for the frames from `fromSeconds` of `recording` onwards, as far as `wantSeconds`. Returns at once; ffmpeg
   * works in the background on the first frames still missing, and a run heading elsewhere is stopped. Another
   * Recording than the one held lets go of everything held.
   */
  want(recording: RecordingInfo, fromSeconds: number): void;
  /**
   * The JPEGs of these frames of `recording`, null for each one not made yet. Frames past the last one the Recording
   * really holds — its own count can promise more (ADR-0009) — answer with that last frame.
   */
  frames(recording: RecordingInfo, indices: readonly number[]): (Uint8Array | null)[];
  /**
   * Why no frame of `recording` can be made, in ffmpeg's own words, once asking has been given up; null while there is
   * nothing to report. The next wish tries again.
   */
  failure(recording: RecordingInfo): string | null;
  /** How many bytes of frames are held. */
  heldBytes(): number;
  /** The latest runs of ffmpeg, oldest first — what the measuring scripts read. */
  runs(): readonly PictureRun[];
  /** Stops ffmpeg and lets go of every frame. */
  stop(): void;
}

/** A run and the ffmpeg process doing it. */
interface RunningFfmpeg {
  child: ChildProcess;
  run: PictureRun;
}

/** The frames held of one Recording, and what is being done about the ones still missing. */
interface RecordingFrames {
  recording: RecordingInfo;
  jpegs: Map<number, Buffer>;
  bytes: number;
  /** The stretch wished for last, in picture frames, the end not included. */
  wanted: { fromFrame: number; toFrame: number } | null;
  running: RunningFfmpeg | null;
  /** The frame after the last one the Recording turned out to hold, once a run ran out of picture. */
  beyond: number | null;
  /** Nothing outside the stretch wished for is left to let go, so the limit is not looked at again until the next wish. */
  nothingToLetGo: boolean;
  /** How often in a row the graphics card refused. */
  hardwareRefusals: number;
  /** The graphics card just refused a stretch, so its next run goes to the processor. */
  retryOnProcessor: boolean;
  /** How many runs in a row brought no frame. */
  emptyRuns: number;
  /** What ffmpeg last said, once asking was given up. */
  failure: string | null;
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

/** What ffmpeg said, for the window to show: its last line, or the exit code when it said nothing at all. */
function reasonOf(errors: string, code: number | null): string {
  const said = errors
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .at(-1);
  return said?.trim() ?? `ffmpeg ended with code ${code} and made no frames.`;
}

/**
 * Makes the picture's frames ahead with the ffmpeg at `ffmpegPath` and holds them in memory, for one Recording at a
 * time (ADR-0028).
 */
export function newPictureFrames(ffmpegPath: string, options: PictureFramesOptions = {}): PictureFrames {
  const height = options.height ?? PICTURE_HEIGHT;
  const wantSeconds = options.wantSeconds ?? LONGEST_EXCERPT_SECONDS;
  const budgetBytes = options.budgetBytes ?? PICTURE_BUDGET_BYTES;
  const hardware = options.hardware === undefined ? CUDA : options.hardware;
  const runs: PictureRun[] = [];
  let held: RecordingFrames | null = null;

  function stopRun(stock: RecordingFrames): void {
    if (!stock.running) return;
    stock.running.run.stopped = true;
    stock.running.child.kill();
    stock.running = null;
  }

  function stopAll(): void {
    if (held) stopRun(held);
    held = null;
  }

  /**
   * Lets go of frames outside the stretch wished for, farthest from it first, until a tenth of the limit is free again
   * — so the sorting happens once in a while rather than for every frame that arrives.
   */
  function makeRoom(stock: RecordingFrames): void {
    const { wanted } = stock;
    if (!wanted) return;
    const distanceOf = (index: number) => (index < wanted.fromFrame ? wanted.fromFrame - index : index - wanted.toFrame + 1);
    const outside = [...stock.jpegs.keys()].filter((index) => index < wanted.fromFrame || index >= wanted.toFrame);
    // The stretch wished for is never given up. Once it fills the memory on its own there is nothing to sort again.
    if (outside.length === 0) {
      stock.nothingToLetGo = true;
      return;
    }
    outside.sort((a, b) => distanceOf(b) - distanceOf(a));
    for (const index of outside) {
      if (stock.bytes <= budgetBytes * 0.9) break;
      stock.bytes -= (stock.jpegs.get(index) as Buffer).length;
      stock.jpegs.delete(index);
    }
  }

  function storeFrame(stock: RecordingFrames, index: number, jpeg: Buffer): void {
    stock.bytes += jpeg.length - (stock.jpegs.get(index)?.length ?? 0);
    stock.jpegs.set(index, jpeg);
    if (stock.bytes > budgetBytes && !stock.nothingToLetGo) makeRoom(stock);
  }

  /** Puts ffmpeg to work on the first frame still missing from what is wanted, unless a run already heads there. */
  function workOnWhatIsMissing(stock: RecordingFrames): void {
    if (!stock.wanted) return;
    const { fromFrame, toFrame } = stock.wanted;
    let missing = fromFrame;
    while (missing < toFrame && stock.jpegs.has(missing)) missing += 1;
    if (missing >= toFrame) {
      stopRun(stock);
      return;
    }
    const run = stock.running?.run;
    // A run that is about to reach the first missing frame — within a second — is left to get there.
    if (run && run.fromFrame <= missing && missing <= run.fromFrame + run.made + pictureRateOf(stock.recording).perSecond) return;
    stopRun(stock);
    let upTo = missing;
    while (upTo < toFrame && !stock.jpegs.has(upTo)) upTo += 1;
    startRun(stock, missing, upTo);
  }

  function startRun(stock: RecordingFrames, fromFrame: number, toFrame: number): void {
    const { recording } = stock;
    const { step } = pictureRateOf(recording);
    const { numerator, denominator } = recording.frameRate;
    // ffmpeg keeps the first frame whose time is not before -ss, so the frame's own time is rounded down to a microsecond.
    const seconds = Math.floor(((fromFrame * step * denominator) / numerator) * 1e6) / 1e6;
    const { width } = pictureSizeOf(recording, height);
    const decoder = hardware && stock.hardwareRefusals < HARDWARE_REFUSALS_BELIEVED && !stock.retryOnProcessor ? hardware : null;
    stock.retryOnProcessor = false;
    // Above 60 frames a second every step-th frame is kept, counted from the first one after -ss.
    const thinning = step > 1 ? [`select=not(mod(n\\,${step}))`] : [];
    const filters = decoder ? [decoder.scale(width, height), ...thinning] : [...thinning, `scale=${width}:${height}`];
    const startedAt = performance.now();
    const child = spawn(
      ffmpegPath,
      [
        ...["-hide_banner", "-loglevel", "error", "-nostdin"],
        ...(decoder ? ["-hwaccel", decoder.hwaccel, "-hwaccel_output_format", decoder.hwaccel] : []),
        ...["-ss", seconds.toFixed(6), "-i", recording.path, "-map", "0:v:0", "-frames:v", String(toFrame - fromFrame)],
        ...["-vf", filters.join(",")],
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
    const run: PictureRun = {
      fromFrame,
      toFrame,
      made: 0,
      running: true,
      stopped: false,
      onProcessor: decoder === null,
      firstFrameMs: null,
      ms: null,
    };
    runs.push(run);
    if (runs.length > RUNS_KEPT) runs.splice(0, runs.length - RUNS_KEPT);
    stock.running = { child, run };

    let pending: Buffer = Buffer.alloc(0);
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let at = 0;
      for (let end = jpegEnd(pending, at); end >= 0; end = jpegEnd(pending, at)) {
        if (!run.stopped) storeFrame(stock, fromFrame + run.made, Buffer.from(pending.subarray(at, end)));
        run.firstFrameMs ??= Math.round(performance.now() - startedAt);
        run.made += 1;
        at = end;
      }
      if (at > 0) pending = pending.subarray(at);
    });
    child.on("error", () => {
      // A missing ffmpeg is reported by "close" with no frames made.
    });
    child.on("close", (code) => {
      run.running = false;
      run.ms = Math.round(performance.now() - startedAt);
      if (stock.running?.run === run) stock.running = null;
      if (run.stopped || held !== stock) return;
      if (run.made > 0) {
        stock.emptyRuns = 0;
        if (decoder) stock.hardwareRefusals = 0;
        // Fewer frames than asked for, and ffmpeg content: the Recording holds no more picture than this, whatever its
        // own frame count promises (ADR-0009). Nothing past that is asked for again.
        if (code === 0 && run.made < run.toFrame - run.fromFrame) {
          stock.beyond = fromFrame + run.made;
          if (stock.wanted) stock.wanted = { ...stock.wanted, toFrame: Math.min(stock.wanted.toFrame, stock.beyond) };
        }
      } else {
        stock.emptyRuns += 1;
        // The graphics card refused: this stretch goes to the processor, and the card is asked again next time.
        if (decoder && (code !== 0 || errors)) {
          stock.hardwareRefusals += 1;
          stock.retryOnProcessor = true;
        }
        if (stock.emptyRuns >= EMPTY_RUNS_BELIEVED) {
          stock.wanted = null;
          stock.failure = reasonOf(errors, code);
          return;
        }
      }
      workOnWhatIsMissing(stock);
    });
  }

  return {
    want(recording, fromSeconds) {
      if (held && held.recording.path !== recording.path) stopAll();
      held ??= {
        recording,
        jpegs: new Map(),
        bytes: 0,
        wanted: null,
        running: null,
        beyond: null,
        nothingToLetGo: false,
        hardwareRefusals: 0,
        retryOnProcessor: false,
        emptyRuns: 0,
        failure: null,
      };
      // Nothing past what the Recording turned out to hold, and nothing past the frame its own count promises.
      const beyond = Math.min(held.beyond ?? Number.POSITIVE_INFINITY, lastPictureFrameOf(recording) + 1);
      const fromFrame = Math.min(frameAtSeconds(recording, fromSeconds), beyond - 1);
      const toFrame = Math.min(fromFrame + Math.round(wantSeconds * pictureRateOf(recording).perSecond), beyond);
      held.wanted = { fromFrame, toFrame };
      held.emptyRuns = 0;
      held.nothingToLetGo = false;
      held.failure = null;
      workOnWhatIsMissing(held);
    },

    frames(recording, indices) {
      const stock = held && held.recording.path === recording.path ? held : null;
      return indices.map((index) => {
        // Past the last frame the Recording holds, its last frame stands in.
        const wanted = stock?.beyond !== null && stock?.beyond !== undefined && index >= stock.beyond ? stock.beyond - 1 : index;
        return stock?.jpegs.get(wanted) ?? null;
      });
    },

    failure(recording) {
      return held && held.recording.path === recording.path ? held.failure : null;
    },

    heldBytes() {
      return held?.bytes ?? 0;
    },

    runs() {
      return runs;
    },

    stop: stopAll,
  };
}
