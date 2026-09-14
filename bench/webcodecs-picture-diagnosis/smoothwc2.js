// Acceptance loop for the WebCodecs picture (ADR-0027), with a timeline of the start. Needs the 25-minute capture open in the Tab on
// screen, window visible. globalThis.__startFraction: where the Playhead goes (0..1 of the whole Recording);
// globalThis.__skip: skip removed parts. Browser functions are wrapped only for the run; the product has no hooks.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (number) =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${number}`);

const select = row(5).querySelector("select");
if (select.value !== "voice") {
  select.value = "voice";
  select.dispatchEvent(new Event("change"));
}
let waited = Date.now();
while (!row(5)?.querySelector("canvas") && Date.now() - waited < 60_000) await wait(100);
if (document.getElementById("result").hidden) {
  document.getElementById("cut").click();
  waited = Date.now();
  while (document.getElementById("result").hidden && Date.now() - waited < 120_000) await wait(100);
}
document.getElementById("skipRemoved").checked = globalThis.__skip ?? true;
await wait(300);
const waveform = row(5).querySelector("canvas");
const box = waveform.getBoundingClientRect();
const x = box.left + box.width * (globalThis.__startFraction ?? 0.19095);
waveform.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: box.top + 5 }));
window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: box.top + 5 }));
await wait(2000);

const picture = document.getElementById("pictureCanvas");
let started = performance.now();
const timeline = {};
const mark = (name) => {
  if (timeline[name] === undefined) timeline[name] = Math.round(performance.now() - started);
};
const draws = [];
let decodes = 0;
const originals = {
  drawImage: CanvasRenderingContext2D.prototype.drawImage,
  start: AudioBufferSourceNode.prototype.start,
  configure: VideoDecoder.prototype.configure,
  decode: VideoDecoder.prototype.decode,
};
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas === picture) {
    draws.push(performance.now());
    mark("firstFrameDrawn");
  }
  return originals.drawImage.apply(this, args);
};
AudioBufferSourceNode.prototype.start = function (...args) {
  mark("soundScheduled");
  return originals.start.apply(this, args);
};
VideoDecoder.prototype.configure = function (...args) {
  mark("decoderConfigured");
  return originals.configure.apply(this, args);
};
VideoDecoder.prototype.decode = function (...args) {
  decodes += 1;
  mark("firstChunkDecoded");
  return originals.decode.apply(this, args);
};
let hiddenAtAnyPoint = false;
try {
  started = performance.now();
  row(5).querySelector("button.play").click();
  while (performance.now() - started < 8000) {
    if (document.visibilityState !== "visible") hiddenAtAnyPoint = true;
    await wait(50);
  }
  row(5).querySelector("button.play").click();
} finally {
  Object.assign(CanvasRenderingContext2D.prototype, { drawImage: originals.drawImage });
  Object.assign(AudioBufferSourceNode.prototype, { start: originals.start });
  Object.assign(VideoDecoder.prototype, { configure: originals.configure, decode: originals.decode });
}

/** Frames shown per second and gaps over 50 ms between `from` and `to` (performance.now times). */
function smoothness(from, to) {
  const shown = draws.filter((at) => at >= from && at <= to);
  const gaps = [];
  for (let at = 1; at < shown.length; at++) {
    const gap = shown[at] - shown[at - 1];
    if (gap > 50) gaps.push({ at: Math.round(shown[at] - started), ms: Math.round(gap) });
  }
  return {
    framesPerSecond: Math.round(shown.length / ((to - from) / 1000)),
    gapsOver50ms: gaps.length,
    longestGapMs: Math.max(0, ...gaps.map((gap) => gap.ms)),
    gaps: gaps.map((gap) => `${gap.at}ms:${gap.ms}`).join(" "),
  };
}

const end = started + 8000;
return {
  hidden: hiddenAtAnyPoint,
  skip: globalThis.__skip ?? true,
  startFraction: globalThis.__startFraction ?? 0.19095,
  timelineMs: timeline,
  chunksDecoded: decodes,
  // The sound is scheduled 50 ms ahead, so this is how long the picture stood still after the sound began.
  pictureBehindSoundAtStartMs:
    timeline.firstFrameDrawn !== undefined && timeline.soundScheduled !== undefined
      ? timeline.firstFrameDrawn - timeline.soundScheduled - 50
      : null,
  fromHalfSecondAfterPress: smoothness(started + 500, end),
  fromHalfSecondAfterFirstFrame: draws.length > 0 ? smoothness(draws[0] + 500, end) : null,
  pictureNote: document.getElementById("pictureNote").hidden ? null : document.getElementById("pictureNote").textContent,
};
