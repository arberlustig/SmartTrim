// Feedback loop for the owner's report: "fine at first, then I click through and it keeps lagging; after Schneiden
// many lags and hangs". Recreates that in the Tab on screen (the 25-minute capture, SourceTrack 5) and measures the picture after each
// phase. Browser functions are wrapped only for the run; the product has no hooks.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (number) =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${number}`);
const picture = document.getElementById("pictureCanvas");

// A fixed stream of pseudo-random numbers, so every run clicks the same places.
let seed = 424242;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const stats = { decodersMade: 0, framesOut: 0, framesClosed: 0, bitmapsMade: 0, bitmapsClosed: 0, readFramesCalls: 0 };
const decoders = new Set();
const draws = [];
const originals = {
  VideoDecoder: window.VideoDecoder,
  frameClose: VideoFrame.prototype.close,
  createImageBitmap: window.createImageBitmap,
  bitmapClose: ImageBitmap.prototype.close,
  drawImage: CanvasRenderingContext2D.prototype.drawImage,
};
window.VideoDecoder = class extends originals.VideoDecoder {
  constructor(init) {
    super({
      output: (frame) => {
        stats.framesOut += 1;
        init.output(frame);
      },
      error: init.error,
    });
    stats.decodersMade += 1;
    decoders.add(this);
  }
};
VideoFrame.prototype.close = function () {
  stats.framesClosed += 1;
  return originals.frameClose.call(this);
};
window.createImageBitmap = function (...args) {
  stats.bitmapsMade += 1;
  return originals.createImageBitmap.apply(this, args);
};
ImageBitmap.prototype.close = function () {
  stats.bitmapsClosed += 1;
  return originals.bitmapClose.call(this);
};
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas === picture) draws.push(performance.now());
  return originals.drawImage.apply(this, args);
};

const openDecoders = () => [...decoders].filter((decoder) => decoder.state !== "closed").length;
const snapshot = () => ({ ...stats, decodersOpen: openDecoders(), framesUnclosed: stats.framesOut - stats.framesClosed });

function clickAt(fraction) {
  const waveform = row(5).querySelector("canvas");
  const box = waveform.getBoundingClientRect();
  const x = box.left + box.width * fraction;
  waveform.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: box.top + 5 }));
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: box.top + 5 }));
}

/** Plays from the Playhead for `ms`, measuring from the first frame drawn plus half a second; stops it again. */
async function measuredPlay(ms) {
  const pressed = performance.now();
  const before = draws.length;
  row(5).querySelector("button.play").click();
  await wait(ms);
  row(5).querySelector("button.play").click();
  const shown = draws.slice(before);
  const from = (shown[0] ?? pressed) + 500;
  const to = pressed + ms;
  const inside = shown.filter((at) => at >= from && at <= to);
  const gaps = [];
  for (let at = 1; at < inside.length; at++) if (inside[at] - inside[at - 1] > 50) gaps.push(Math.round(inside[at] - inside[at - 1]));
  return {
    firstFrameMs: shown.length ? Math.round(shown[0] - pressed) : null,
    framesPerSecond: Math.round(inside.length / Math.max((to - from) / 1000, 0.001)),
    gapsOver50ms: gaps.length,
    longestGapMs: Math.max(0, ...gaps),
    hidden: document.visibilityState !== "visible",
    after: snapshot(),
  };
}

const report = {};
try {
  const select = row(5).querySelector("select");
  if (select.value !== "voice") {
    select.value = "voice";
    select.dispatchEvent(new Event("change"));
  }
  let waited = Date.now();
  while (!row(5)?.querySelector("canvas") && Date.now() - waited < 60_000) await wait(100);
  document.getElementById("skipRemoved").checked = false;

  clickAt(0.19095);
  await wait(1500);
  report.baseline = await measuredPlay(5000);
  await wait(500);

  // Clicking through while stopped: every click asks for a still frame.
  for (let click = 0; click < 15; click++) {
    clickAt(0.05 + random() * 0.9);
    await wait(300);
  }
  await wait(1500);
  report.afterClickingStopped = await measuredPlay(5000);
  await wait(500);

  // Clicking while playing: every click jumps and plays on.
  row(5).querySelector("button.play").click();
  await wait(1500);
  for (let click = 0; click < 10; click++) {
    clickAt(0.05 + random() * 0.9);
    await wait(700);
  }
  row(5).querySelector("button.play").click();
  await wait(1500);
  clickAt(0.38699);
  await wait(1500);
  report.afterClickingWhilePlaying = await measuredPlay(5000);
  await wait(500);

  document.getElementById("cut").click();
  waited = Date.now();
  while (document.getElementById("result").hidden && Date.now() - waited < 120_000) await wait(100);
  document.getElementById("skipRemoved").checked = true;
  await wait(1000);
  clickAt(0.67134);
  await wait(1500);
  report.afterCutSkipping = await measuredPlay(6000);
  await wait(500);
  clickAt(0.19095);
  await wait(1500);
  report.afterCutSkippingAgain = await measuredPlay(6000);
} finally {
  window.VideoDecoder = originals.VideoDecoder;
  Object.assign(VideoFrame.prototype, { close: originals.frameClose });
  window.createImageBitmap = originals.createImageBitmap;
  Object.assign(ImageBitmap.prototype, { close: originals.bitmapClose });
  Object.assign(CanvasRenderingContext2D.prototype, { drawImage: originals.drawImage });
}
report.pictureNote = document.getElementById("pictureNote").hidden ? null : document.getElementById("pictureNote").textContent;
report.status = document.getElementById("status").textContent;
return report;
