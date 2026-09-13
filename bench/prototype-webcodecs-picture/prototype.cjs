// PROTOTYPE, throw away. Runs in the prototype window (Node enabled). See main.cjs for the question and how to run.
//
// For each of the owner's densest cut stretches: decode the kept pieces of 8 s of what is played, in order, with a
// hardware VideoDecoder, keeping at most LEAD_SECONDS of decoded frames ahead of the clock; draw the frame that is due
// on every animation frame; count what the eye would see.
const fs = require("node:fs");
const path = require("node:path");
const { hevcConfigOf, packetsBetween } = require("./mp4.cjs");

const repo = path.resolve(__dirname, "../..");
const args = JSON.parse(new URLSearchParams(location.search).get("args") || "[]");
const recordingPath = args.find((arg) => !arg.startsWith("--")) || "C:/Users/user/Downloads/capture-25min.mp4";
const quitWhenDone = args.includes("--quit");
const ffprobe = path.join(repo, "vendor", "ffprobe.exe");
const { kept } = JSON.parse(fs.readFileSync(path.join(repo, "bench", "out", "the 25-minute capture-owner-kept.json"), "utf8"));

const STRETCHES = [289.1, 585.933, 1016.383];
const PLAY_SECONDS = 8;
const LEAD_SECONDS = 0.5;
const BITMAP_BYTES = 1920 * 1080 * 4;

const logElement = document.getElementById("log");
const log = (line) => {
  logElement.textContent += `${line}\n`;
  console.log(line);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The kept pieces of PLAY_SECONDS of what is played from `startSeconds`, the way skipping plays them. */
function piecesFrom(startSeconds) {
  const pieces = [];
  let played = 0;
  for (const range of kept) {
    if (range.endSeconds <= startSeconds) continue;
    const from = Math.max(range.startSeconds, startSeconds);
    const length = Math.min(range.endSeconds - from, PLAY_SECONDS - played);
    pieces.push({ from, to: from + length, playedFrom: played });
    played += length;
    if (played >= PLAY_SECONDS - 1e-9) break;
  }
  return pieces;
}

/** How fast the decoder turns packets into frames when nothing holds it back: 10 s from a keyframe, frames closed at once. */
async function rawThroughput(config, startSeconds) {
  const packets = packetsBetween(ffprobe, recordingPath, startSeconds, startSeconds + 10);
  const fd = fs.openSync(recordingPath, "r");
  const first = packets.findIndex((packet) => packet.key);
  let frames = 0;
  const decoder = new VideoDecoder({ output: (frame) => { frames += 1; frame.close(); }, error: (error) => log(`raw error ${error.message}`) });
  decoder.configure(config);
  const started = performance.now();
  for (let at = first; at < packets.length; at++) {
    const packet = packets[at];
    while (decoder.decodeQueueSize > 16) await sleep(0);
    const data = Buffer.alloc(packet.size);
    fs.readSync(fd, data, 0, packet.size, packet.pos);
    decoder.decode(new EncodedVideoChunk({ type: packet.key ? "key" : "delta", timestamp: Math.round(packet.pts * 1e6), data }));
  }
  await decoder.flush();
  const seconds = (performance.now() - started) / 1000;
  decoder.close();
  fs.closeSync(fd);
  return { frames, seconds: Number(seconds.toFixed(2)), framesPerSecond: Math.round(frames / seconds) };
}

/** Plays one stretch through WebCodecs onto the canvas and measures it. `hold` is "bitmap" or "frame". */
async function playStretch(config, startSeconds, hold) {
  const pieces = piecesFrom(startSeconds);
  const totalPlayed = pieces.reduce((total, piece) => total + (piece.to - piece.from), 0);
  const probeStarted = performance.now();
  const packets = packetsBetween(ffprobe, recordingPath, pieces[0].from - 5, pieces[pieces.length - 1].to + 1);
  const probeMs = Math.round(performance.now() - probeStarted);
  const fd = fs.openSync(recordingPath, "r");

  /** Decoded frames due to be shown, in order: when in what is played, and the image. */
  const queue = [];
  let current = null;
  let decodedFrames = 0;
  let discardedFrames = 0;
  let maxQueue = 0;
  let decoderErrors = 0;
  let stopped = false;
  let t0 = null;
  const clock = () => (t0 === null ? 0 : (performance.now() - t0) / 1000);
  const lead = () => (queue.length > 0 ? queue[queue.length - 1].played - clock() : 0);
  const closeImage = (entry) => entry.image?.close();

  const decoder = new VideoDecoder({
    output: (frame) => {
      decodedFrames += 1;
      const piece = current;
      const at = frame.timestamp / 1e6;
      // Frames before the piece (decoded only to get there) and after it are not shown.
      if (!piece || at < piece.from - 0.004 || at >= piece.to - 0.004) {
        frame.close();
        discardedFrames += 1;
        return;
      }
      const entry = { played: piece.playedFrom + (at - piece.from), recording: at, piece, image: null };
      queue.push(entry);
      maxQueue = Math.max(maxQueue, queue.length);
      if (hold === "frame") {
        entry.image = frame;
      } else {
        // A copy the decoder does not have to keep a surface for — at full size, or at the size the window draws.
        const size = hold === "bitmap-small" ? { resizeWidth: 960, resizeHeight: 540, resizeQuality: "medium" } : undefined;
        createImageBitmap(frame, size).then((bitmap) => {
          entry.image = bitmap;
          frame.close();
        });
      }
    },
    error: (error) => {
      decoderErrors += 1;
      log(`decoder error: ${error.message}`);
    },
  });
  decoder.configure(config);

  const feeding = (async () => {
    for (const piece of pieces) {
      if (stopped) break;
      current = piece;
      let first = -1;
      for (let at = 0; at < packets.length; at++) if (packets[at].key && packets[at].pts <= piece.from + 0.001) first = at;
      for (let at = first; at < packets.length && !stopped; at++) {
        const packet = packets[at];
        // Frames shown before `to` can come from packets decoded a little after it (B-frames).
        if (packet.dts >= piece.to + 0.1) break;
        while (!stopped && (lead() > LEAD_SECONDS || decoder.decodeQueueSize > 8)) await sleep(2);
        const data = Buffer.alloc(packet.size);
        fs.readSync(fd, data, 0, packet.size, packet.pos);
        decoder.decode(new EncodedVideoChunk({ type: at === first || packet.key ? "key" : "delta", timestamp: Math.round(packet.pts * 1e6), data }));
      }
      if (!stopped) await decoder.flush();
    }
  })();

  const canvas = document.getElementById("picture");
  const paint = canvas.getContext("2d");
  const goAt = performance.now();
  let firstFrameMs = null;
  let shownFrames = 0;
  let skippedFrames = 0;
  let lastShownAt = null;
  let shown = null;
  const gaps = [];
  const joinLateMs = [];

  // The window process's memory while the stretch plays, read every 200 ms.
  const rssAtStart = process.memoryUsage().rss;
  let rssPeak = rssAtStart;
  const sampling = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  }, 200);

  await new Promise((resolve) => {
    const tick = (now) => {
      if (t0 === null) {
        if (!queue[0]?.image) return requestAnimationFrame(tick);
        t0 = now;
        firstFrameMs = Math.round(now - goAt);
      }
      const played = (now - t0) / 1000;
      if (played >= totalPlayed) return resolve();
      let pick = null;
      while (queue.length > 0 && queue[0].image && queue[0].played <= played + 0.001) {
        if (pick) {
          closeImage(pick);
          skippedFrames += 1;
        }
        pick = queue.shift();
      }
      if (pick) {
        paint.drawImage(pick.image, 0, 0, 1920, 1080);
        const joined = shown !== null && pick.piece !== shown.piece;
        if (lastShownAt !== null && now - lastShownAt > 50 && played > 0.5) {
          gaps.push({ atMs: Math.round(played * 1000), ms: Math.round(now - lastShownAt), join: joined });
        }
        if (joined) joinLateMs.push(Math.round((played - pick.piece.playedFrom) * 1000));
        if (shown) closeImage(shown);
        shown = pick;
        shownFrames += 1;
        lastShownAt = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  clearInterval(sampling);
  stopped = true;
  await feeding.catch(() => undefined);
  decoder.close();
  for (const entry of queue) closeImage(entry);
  if (shown) closeImage(shown);
  fs.closeSync(fd);

  const measuredSeconds = totalPlayed - 0.5;
  return {
    startSeconds,
    hold,
    joins: pieces.length - 1,
    shortestPieceSeconds: Number(Math.min(...pieces.map((piece) => piece.to - piece.from)).toFixed(2)),
    probeMs,
    firstFrameMs,
    framesShownPerSecond: Math.round(shownFrames / totalPlayed),
    skippedFrames,
    gapsOver50ms: gaps.length,
    gapsOver150ms: gaps.filter((gap) => gap.ms > 150).length,
    longestGapMs: Math.max(0, ...gaps.map((gap) => gap.ms)),
    gapsAtJoins: gaps.filter((gap) => gap.join).length,
    firstFrameOfPieceLateMs: { worst: Math.max(0, ...joinLateMs), all: joinLateMs.join(" ") },
    decodedFrames,
    discardedFrames,
    decodedPerSecondOfPlay: Math.round(decodedFrames / measuredSeconds),
    maxQueuedFrames: maxQueue,
    maxQueuedMegabytesIfBitmaps: Math.round((maxQueue * BITMAP_BYTES * (hold === "bitmap-small" ? 0.25 : 1)) / 1e6),
    windowMemoryMegabytes: { atStart: Math.round(rssAtStart / 1e6), peak: Math.round(rssPeak / 1e6) },
    decoderErrors,
    gaps: gaps.map((gap) => `${gap.atMs}:${gap.ms}${gap.join ? "J" : ""}`).join(" "),
  };
}

(async () => {
  const results = { recordingPath, at: new Date().toISOString(), runs: [] };
  try {
    const { codec, description } = hevcConfigOf(recordingPath);
    const config = { codec, description, codedWidth: 1920, codedHeight: 1080, hardwareAcceleration: "prefer-hardware", optimizeForLatency: true };
    const support = await VideoDecoder.isConfigSupported(config);
    results.codec = codec;
    results.supported = support.supported;
    log(`codec ${codec}, hardware supported: ${support.supported}`);
    if (!support.supported) throw new Error("This HEVC configuration is not supported by VideoDecoder here.");
    results.rawThroughput = await rawThroughput(config, STRETCHES[0]);
    log(`raw decode: ${JSON.stringify(results.rawThroughput)}`);
    // "frame" (holding the decoder's own frames) was measured first and stuttered at Joins: 58-59 frames/s, gaps up to
    // 122 ms, since the hardware decoder only has a dozen or so surfaces to hand out.
    for (const hold of ["bitmap", "bitmap-small"]) {
      for (const startSeconds of STRETCHES) {
        const run = await playStretch(config, startSeconds, hold);
        results.runs.push(run);
        log(JSON.stringify(run));
        await sleep(500);
      }
    }
  } catch (error) {
    results.error = String(error && error.stack ? error.stack : error);
    log(`FAILED: ${results.error}`);
  }
  fs.writeFileSync(path.join(repo, "bench", "out", "prototype-webcodecs-picture.json"), JSON.stringify(results, null, 1));
  log("done: bench/out/prototype-webcodecs-picture.json");
  if (quitWhenDone) window.close();
})();
