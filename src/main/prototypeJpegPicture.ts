// PROTOTYPE (branch prototype/jpeg-picture, 2026-09-14), throwaway: ffmpeg decodes a Tab's picture ahead into small JPEG
// frames held in this process's memory, and the window draws them along the sound. It answers one question: does that
// stay smooth at every Join in the owner's own use? See bench/prototype-jpeg-picture/README.md. No tests, by design.
import { spawn, type ChildProcess } from "node:child_process";
import { constants, setPriority } from "node:os";
import { app, ipcMain } from "electron";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";

/** Height of a frame in pixels; the width follows the Recording's shape. */
const HEIGHT = 450;
/** ffmpeg's MJPEG quality scale, 2 (best) to 31. 8 measured 147 MB per minute of the 25-minute capture. */
const QUALITY = 8;
/** How much picture is made from where the Playhead is: what one press of ▶ can play. */
const WANT_SECONDS = 180;
/** Frames beyond this are let go, farthest from what is wanted first (owner's limit is 2 GB for the picture). */
const BUDGET_BYTES = 1.5 * 1024 ** 3;

interface Run {
  child: ChildProcess;
  from: number;
  next: number;
  end: number;
  startedAt: number;
  firstFrameMs: number | null;
  decoder: string;
  killed: boolean;
}

interface Store {
  tabId: number;
  path: string;
  numerator: number;
  denominator: number;
  perSecond: number;
  totalFrames: number;
  width: number;
  frames: Map<number, Buffer>;
  bytes: number;
  run: Run | null;
  want: { from: number; end: number } | null;
  runs: Record<string, unknown>[];
  decoder: "cuda" | "software";
  /** Runs in a row that brought nothing, so a stretch ffmpeg cannot give is not asked for forever. */
  emptyRuns: number;
}

/** Knobs the measuring scripts turn over IPC, so variants compare in one window without restarting it. */
interface Tuning {
  /** "low" starts the picture's ffmpeg below normal priority, so reading the sound comes first. */
  priority: "normal" | "low";
  /** ffmpeg -threads for the picture; 0 leaves ffmpeg's own choice. */
  threads: number;
}

/** Where the JPEG starting at `start` ends, or -1 while it has not arrived whole. */
function jpegEnd(buffer: Buffer, start: number): number {
  let at = start + 2;
  while (at + 2 <= buffer.length) {
    if (buffer[at] !== 0xff) throw new Error(`not a JPEG marker at ${at}`);
    const marker = buffer[at + 1] as number;
    if (marker === 0xd9) return at + 2;
    if (at + 4 > buffer.length) return -1;
    const length = buffer.readUInt16BE(at + 2);
    if (marker !== 0xda) {
      at += 2 + length;
      continue;
    }
    // Entropy-coded data: a 0xFF inside it is followed by 0x00 or a restart marker; anything else ends it.
    // indexOf, not a loop over bytes: at 1400 frames a second of 40 KB each, a JavaScript loop stalled the main process.
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

export function registerJpegPicture(recordingOf: (tabId: number) => RecordingInfo, ffmpegPath: () => Promise<string>): void {
  let store: Store | null = null;
  let ffmpeg: string | null = null;
  // Measured 2026-09-14 on the 25-minute capture: the sound came about 245 ms later than with the picture folded at normal priority,
  // 180 ms at low priority, 155 ms at low priority with 4 threads, the picture equally smooth in all three.
  const tuning: Tuning = { priority: "low", threads: 4 };

  function storeFor(tabId: number): Store {
    const recording = recordingOf(tabId);
    if (store && store.tabId === tabId && store.path === recording.path) return store;
    if (store) stopRun(store);
    const { numerator, denominator } = recording.frameRate;
    store = {
      tabId,
      path: recording.path,
      numerator,
      denominator,
      perSecond: numerator / denominator,
      totalFrames: recording.durationFrames,
      width: Math.round((HEIGHT * recording.width) / recording.height / 2) * 2,
      frames: new Map(),
      bytes: 0,
      run: null,
      want: null,
      runs: [],
      decoder: "cuda",
      emptyRuns: 0,
    };
    return store;
  }

  function stopRun(s: Store): void {
    if (!s.run) return;
    s.run.killed = true;
    s.run.child.kill();
    s.run = null;
  }

  function add(s: Store, index: number, frame: Buffer): void {
    const old = s.frames.get(index);
    if (old) s.bytes -= old.length;
    s.frames.set(index, frame);
    s.bytes += frame.length;
    if (s.bytes <= BUDGET_BYTES || !s.want) return;
    const keepFrom = s.want.from - 60 * s.perSecond;
    for (const [at, bytes] of s.frames) {
      if (at >= keepFrom && at < s.want.end) continue;
      s.frames.delete(at);
      s.bytes -= bytes.length;
    }
  }

  /** Makes sure ffmpeg works on the first frames missing from what is wanted, unless a run already heads there. */
  function ensure(s: Store): void {
    if (!s.want || !ffmpeg) return;
    const { from, end } = s.want;
    let missing = from;
    while (missing < end && s.frames.has(missing)) missing += 1;
    if (missing >= end) {
      stopRun(s);
      return;
    }
    if (s.run && s.run.from <= missing && missing <= s.run.next + s.perSecond) return;
    stopRun(s);
    let stop = missing;
    while (stop < end && !s.frames.has(stop)) stop += 1;
    start(s, missing, stop);
  }

  function start(s: Store, from: number, stop: number): void {
    // The first frame kept is the one whose time is not before -ss, so -ss is rounded down to a microsecond.
    const seconds = Math.floor(((from * s.denominator) / s.numerator) * 1e6) / 1e6;
    const cuda = s.decoder === "cuda";
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      ...(cuda ? ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] : []),
      "-ss",
      seconds.toFixed(6),
      "-i",
      s.path,
      "-map",
      "0:v:0",
      "-frames:v",
      String(stop - from),
      "-vf",
      cuda ? `scale_cuda=${s.width}:${HEIGHT},hwdownload,format=nv12` : `scale=${s.width}:${HEIGHT}`,
      "-pix_fmt",
      "yuvj420p",
      "-c:v",
      "mjpeg",
      "-q:v",
      String(QUALITY),
      ...(tuning.threads > 0 ? ["-threads", String(tuning.threads)] : []),
      "-f",
      "image2pipe",
      "-",
    ];
    const child = spawn(ffmpeg as string, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    if (tuning.priority === "low" && child.pid !== undefined) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // Measured either way; the run records which tuning it had.
      }
    }
    const run: Run = { child, from, next: from, end: stop, startedAt: performance.now(), firstFrameMs: null, decoder: s.decoder, killed: false };
    const runTuning = `${tuning.priority}/${tuning.threads || "auto"}`;
    s.run = run;
    let pending: Buffer = Buffer.alloc(0);
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let at = 0;
      for (;;) {
        const end = jpegEnd(pending, at);
        if (end < 0) break;
        if (run.firstFrameMs === null) run.firstFrameMs = Math.round(performance.now() - run.startedAt);
        if (store === s) add(s, run.next, Buffer.from(pending.subarray(at, end)));
        run.next += 1;
        at = end;
      }
      if (at > 0) pending = pending.subarray(at);
    });
    child.on("close", (code) => {
      const ms = performance.now() - run.startedAt;
      s.runs.push({
        from,
        stop,
        made: run.next - from,
        leftBytes: pending.length,
        decoder: run.decoder,
        tuning: runTuning,
        firstFrameMs: run.firstFrameMs,
        ms: Math.round(ms),
        framesPerSecond: Math.round(((run.next - from) * 1000) / ms),
        killed: run.killed,
        code,
        errors: errors.slice(0, 300),
      });
      if (s.runs.length > 200) s.runs.splice(0, 100);
      if (s.run === run) s.run = null;
      if (run.killed || store !== s) return;
      if (run.next > from) {
        s.emptyRuns = 0;
      } else {
        // Nothing came out. Only an ffmpeg that failed with the graphics card is tried again on the processor; a run
        // that simply brought nothing three times in a row gives up on what is wanted.
        s.emptyRuns += 1;
        if (s.decoder === "cuda" && (code !== 0 || errors)) s.decoder = "software";
        if (s.emptyRuns >= 3) {
          s.want = null;
          return;
        }
      }
      ensure(s);
    });
  }

  ipcMain.handle("prototype:prep", async (_event, { tabId, fromSeconds }: { tabId: number; fromSeconds: number }) => {
    ffmpeg ??= await ffmpegPath();
    const s = storeFor(tabId);
    const from = Math.max(0, Math.floor(fromSeconds * s.perSecond + 1e-6));
    s.want = { from, end: Math.min(from + Math.round(WANT_SECONDS * s.perSecond), s.totalFrames) };
    s.emptyRuns = 0;
    ensure(s);
    let ready = from;
    while (s.frames.has(ready)) ready += 1;
    return ready - from;
  });
  ipcMain.handle("prototype:frames", (_event, { tabId, indices }: { tabId: number; indices: number[] }) =>
    indices.map((index) => (store?.tabId === tabId ? (store.frames.get(index) ?? null) : null)),
  );
  ipcMain.handle("prototype:ping", () => null);
  ipcMain.handle("prototype:tune", (_event, next: Partial<Tuning>) => Object.assign(tuning, next));
  /** Forgets every frame made so far, so a variant starts from the same empty memory as the one before. */
  ipcMain.handle("prototype:forget", () => {
    if (store) {
      stopRun(store);
      store.frames.clear();
      store.bytes = 0;
      store.want = null;
    }
    return null;
  });
  ipcMain.handle("prototype:stats", () => ({
    megabytes: Math.round((store?.bytes ?? 0) / 1e6),
    frames: store?.frames.size ?? 0,
    decoder: store?.decoder ?? null,
    tuning,
    running: store?.run ? { from: store.run.from, next: store.run.next, end: store.run.end } : null,
    runs: store?.runs.slice(-40) ?? [],
    processes: app.getAppMetrics().map((metric) => ({
      type: metric.type,
      megabytes: Math.round(metric.memory.workingSetSize / 1024),
      cpu: Math.round(metric.cpu.percentCPUUsage),
    })),
  }));
}
