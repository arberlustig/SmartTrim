import type { PiecePicture, StillPicture } from "../video/picturePlan.ts";
import type { DecoderConfig, IndexedFrame } from "../video/videoIndex.ts";

/**
 * How far ahead of the sound frames are kept decoded. Copied at 960 px wide, half a second of a 60 fps picture is
 * about 90 MB, and the hardware decoder turns out some 1,050 frames a second, so it keeps well ahead (ADR-0027).
 */
const LEAD_SECONDS = 0.5;
/** How many frames are read from the Recording in one request: half a second at 60 frames a second. */
const FRAMES_PER_READ = 30;
/** How many chunks may wait inside the decoder before feeding it pauses. */
const DECODE_QUEUE_LIMIT = 8;
/**
 * The width decoded frames are copied at. The decoder's own frames cannot be held: it hands out a dozen or so surfaces,
 * and holding them stalls it. Copies at the size the window draws were the smoothest in the prototype (ADR-0027).
 */
const COPY_WIDTH = 960;

/** Reads the bytes of frames a plan names from the Recording, one array per frame. */
export type ReadFrames = (frames: readonly IndexedFrame[]) => Promise<Uint8Array[]>;

/** The size of the Recording's picture, as probed. */
export interface PictureSize {
  width: number;
  height: number;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function copyOptions(size: PictureSize): ImageBitmapOptions {
  const resizeHeight = Math.max(1, Math.round((COPY_WIDTH * size.height) / size.width));
  return { resizeWidth: COPY_WIDTH, resizeHeight, resizeQuality: "medium" };
}

/**
 * A decoder set up for the Recording's picture: in the graphics chip if it can, else however this window can. Refused
 * with a reason when the window cannot decode it at all.
 */
async function decoderFor(config: DecoderConfig, size: PictureSize, init: VideoDecoderInit): Promise<VideoDecoder> {
  const base: VideoDecoderConfig = {
    codec: config.codec,
    description: config.description,
    codedWidth: size.width,
    codedHeight: size.height,
    optimizeForLatency: true,
  };
  for (const hardwareAcceleration of ["prefer-hardware", "no-preference"] as const) {
    const wanted = { ...base, hardwareAcceleration };
    if (!(await VideoDecoder.isConfigSupported(wanted)).supported) continue;
    const decoder = new VideoDecoder(init);
    decoder.configure(wanted);
    return decoder;
  }
  throw new Error(`this window cannot decode ${config.codec}`);
}

/** Hands one frame's bytes to the decoder. */
function decode(decoder: VideoDecoder, frame: IndexedFrame, data: Uint8Array | undefined): void {
  decoder.decode(
    new EncodedVideoChunk({ type: frame.key ? "key" : "delta", timestamp: frame.pts, data: data ?? new Uint8Array() }),
  );
}

/** Draws a copied frame over the whole canvas and lets the copy go: the canvas keeps its pixels. */
function paint(canvas: HTMLCanvasElement, image: ImageBitmap): void {
  if (canvas.width !== image.width || canvas.height !== image.height) {
    canvas.width = image.width;
    canvas.height = image.height;
  }
  canvas.getContext("2d")?.drawImage(image, 0, 0);
  image.close();
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A decoded frame waiting to go on screen: from which moment of what is played, and its copy once it is made. */
interface Waiting {
  playedSeconds: number;
  image: ImageBitmap | null;
  dropped: boolean;
}

/** What a PictureRun needs: where to draw, what to decode, and the clock of the sound it follows. */
export interface PictureRunOptions {
  canvas: HTMLCanvasElement;
  decoder: DecoderConfig;
  size: PictureSize;
  pieces: readonly PiecePicture[];
  readFrames: ReadFrames;
  /** How far the sound has played, in seconds of what is played. */
  playedSeconds: () => number;
  /** Told once why the picture cannot go on, after the run has stopped itself. */
  failed: (message: string) => void;
}

/**
 * The picture of what is played. It decodes the kept pieces in order, never more than LEAD_SECONDS ahead of the
 * sound, and draws whichever frame is due when asked. The sound is the clock; the picture only follows it (ADR-0027).
 */
export class PictureRun {
  private readonly waiting: Waiting[] = [];
  private decoder: VideoDecoder | null = null;
  private stopped = false;
  /** When in what is played the latest decoded frame goes on screen. */
  private latestQueued = Number.NEGATIVE_INFINITY;
  /** For the piece being decoded: from which moment of what is played each frame to show goes on screen, by pts. */
  private showing = new Map<number, number>();

  private constructor(private readonly options: PictureRunOptions) {}

  /** Starts decoding. Refused when the window cannot decode the Recording's picture. */
  static async start(options: PictureRunOptions): Promise<PictureRun> {
    const run = new PictureRun(options);
    run.decoder = await decoderFor(options.decoder, options.size, {
      output: (frame) => run.decoded(frame),
      error: (error) => run.fail(error),
    });
    void run.feed();
    return run;
  }

  /** Puts the frame due at `playedSeconds` on the canvas. Frames the sound has already passed are dropped unseen. */
  drawAt(playedSeconds: number): void {
    let due: Waiting | undefined;
    for (let next = this.waiting[0]; next?.image && next.playedSeconds <= playedSeconds; next = this.waiting[0]) {
      due?.image?.close();
      due = this.waiting.shift();
    }
    if (due?.image) paint(this.options.canvas, due.image);
  }

  /** Stops decoding and lets go of every frame. Nothing is drawn after this. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    for (const entry of this.waiting) {
      entry.dropped = true;
      entry.image?.close();
    }
    this.waiting.length = 0;
  }

  private decoded(frame: VideoFrame): void {
    const playedSeconds = this.showing.get(frame.timestamp);
    // A frame decoded only to get to the ones shown.
    if (this.stopped || playedSeconds === undefined) {
      frame.close();
      return;
    }
    const entry: Waiting = { playedSeconds, image: null, dropped: false };
    this.waiting.push(entry);
    this.latestQueued = playedSeconds;
    createImageBitmap(frame, copyOptions(this.options.size))
      .then(
        (image) => {
          if (entry.dropped) image.close();
          else entry.image = image;
        },
        (error: unknown) => this.fail(error),
      )
      .finally(() => frame.close());
  }

  private async feed(): Promise<void> {
    const decoder = this.decoder;
    if (!decoder) return;
    try {
      for (const piece of this.options.pieces) {
        this.showing = new Map(piece.shown.map(({ pts, playedSeconds }) => [pts, playedSeconds]));
        for (let at = 0; at < piece.feed.length; at += FRAMES_PER_READ) {
          const frames = piece.feed.slice(at, at + FRAMES_PER_READ);
          const bytes = await this.options.readFrames(frames);
          for (const [index, frame] of frames.entries()) {
            while (!this.stopped && (this.lead() > LEAD_SECONDS || decoder.decodeQueueSize > DECODE_QUEUE_LIMIT)) {
              await wait(4);
            }
            if (this.stopped) return;
            decode(decoder, frame, bytes[index]);
          }
        }
        if (this.stopped) return;
        // Every piece starts at a keyframe of its own, and only a flushed decoder may start at one again.
        await decoder.flush();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private lead(): number {
    return this.latestQueued - this.options.playedSeconds();
  }

  private fail(error: unknown): void {
    if (this.stopped) return;
    this.stop();
    this.options.failed(messageOf(error));
  }
}

/**
 * Decodes the still frame a plan names and draws it. `wanted` says whether it is still wanted once each wait is over:
 * a click elsewhere, or a sound starting, makes a frame on its way useless. Refused with a reason when it fails.
 */
export async function drawStill(
  canvas: HTMLCanvasElement,
  still: StillPicture,
  size: PictureSize,
  readFrames: ReadFrames,
  wanted: () => boolean,
): Promise<void> {
  const found: { frame: VideoFrame | null; error: unknown } = { frame: null, error: null };
  const decoder = await decoderFor(still.decoder, size, {
    output: (frame) => {
      if (frame.timestamp === still.pts && !found.frame) found.frame = frame;
      else frame.close();
    },
    error: (error) => {
      found.error = error;
    },
  });
  try {
    for (let at = 0; at < still.feed.length; at += FRAMES_PER_READ) {
      const frames = still.feed.slice(at, at + FRAMES_PER_READ);
      const bytes = await readFrames(frames);
      if (!wanted()) return;
      for (const [index, frame] of frames.entries()) {
        while (decoder.decodeQueueSize > DECODE_QUEUE_LIMIT) await wait(1);
        decode(decoder, frame, bytes[index]);
      }
    }
    await decoder.flush();
    if (found.error) throw found.error;
    if (!found.frame) throw new Error(`the decoder turned out no frame at ${still.pts}`);
    if (!wanted()) return;
    const image = await createImageBitmap(found.frame, copyOptions(size));
    if (wanted()) paint(canvas, image);
    else image.close();
  } finally {
    found.frame?.close();
    if (decoder.state !== "closed") decoder.close();
  }
}
