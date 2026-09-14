// Passive recorder for the owner's "picture lags after clicking and cutting". Installed once per page load over CDP,
// it keeps recording whatever happens in the window — scripted or by hand — until report.js reads it. Browser
// functions are wrapped in the page only; the product has no hooks.
if (window.__recorder) {
  // Installed already: start a fresh recording without wrapping anything a second time.
  const old = window.__recorder;
  old.t0 = performance.now();
  for (const list of [old.events, old.draws, old.lateAnimationFrames, old.longFrames, old.longTasks]) list.length = 0;
  old.decoders.clear();
  Object.assign(old.stats, { framesOut: 0, framesClosed: 0, bitmapsMade: 0, bitmapsClosed: 0 });
  return "reset";
}
const picture = document.getElementById("pictureCanvas");
const r = {
  t0: performance.now(),
  events: [],
  draws: [],
  lateAnimationFrames: [],
  longFrames: [],
  longTasks: [],
  decoders: new Set(),
  stats: { framesOut: 0, framesClosed: 0, bitmapsMade: 0, bitmapsClosed: 0 },
};
window.__recorder = r;
const now = () => Math.round(performance.now() - r.t0);
const note = (what, detail) => r.events.push({ at: now(), what, detail });

const Decoder = window.VideoDecoder;
window.VideoDecoder = class extends Decoder {
  constructor(init) {
    super({
      output: (frame) => {
        r.stats.framesOut += 1;
        init.output(frame);
      },
      error: (error) => {
        note("decoderError", String(error?.message ?? error));
        init.error(error);
      },
    });
    r.decoders.add(this);
  }
};
const frameClose = VideoFrame.prototype.close;
VideoFrame.prototype.close = function () {
  r.stats.framesClosed += 1;
  return frameClose.call(this);
};
const makeBitmap = window.createImageBitmap;
window.createImageBitmap = function (...args) {
  r.stats.bitmapsMade += 1;
  return makeBitmap.apply(this, args);
};
const bitmapClose = ImageBitmap.prototype.close;
ImageBitmap.prototype.close = function () {
  r.stats.bitmapsClosed += 1;
  return bitmapClose.call(this);
};
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas === picture) r.draws.push(performance.now() - r.t0);
  return drawImage.apply(this, args);
};
const soundStart = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (...args) {
  note("soundStart");
  return soundStart.apply(this, args);
};
const soundStop = AudioBufferSourceNode.prototype.stop;
AudioBufferSourceNode.prototype.stop = function (...args) {
  note("soundStop");
  return soundStop.apply(this, args);
};

document.addEventListener(
  "pointerdown",
  (event) => {
    const canvas = event.target.closest?.("canvas");
    if (canvas) note("pointerdown", canvas.id || "waveform");
  },
  true,
);
document.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest?.("button");
    if (button) note("click", `${button.id || button.className}:${button.textContent.trim().slice(0, 24)}`);
  },
  true,
);
document.addEventListener("wheel", (event) => note("wheel", Math.sign(event.deltaY)), { capture: true, passive: true });

// Animation frames that came later than 50 ms after the one before: the window's thread was busy.
let lastAnimationFrame = performance.now();
const everyFrame = (at) => {
  if (at - lastAnimationFrame > 50) r.lateAnimationFrames.push({ at: Math.round(at - r.t0), ms: Math.round(at - lastAnimationFrame) });
  lastAnimationFrame = at;
  requestAnimationFrame(everyFrame);
};
requestAnimationFrame(everyFrame);

try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      r.longFrames.push({
        at: Math.round(entry.startTime - r.t0),
        ms: Math.round(entry.duration),
        blockingMs: Math.round(entry.blockingDuration ?? 0),
        renderMs: Math.round((entry.startTime + entry.duration) - (entry.renderStart ?? entry.startTime + entry.duration)),
        scripts: (entry.scripts ?? [])
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3)
          .map((script) => `${script.invoker ?? ""} ${script.sourceFunctionName ?? ""} ${Math.round(script.duration)}ms`),
      });
    }
  }).observe({ type: "long-animation-frame", buffered: false });
} catch (error) {
  note("noLongAnimationFrame", String(error));
}
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) r.longTasks.push({ at: Math.round(entry.startTime - r.t0), ms: Math.round(entry.duration) });
  }).observe({ type: "longtask", buffered: false });
} catch (error) {
  note("noLongTask", String(error));
}
return "installed";
