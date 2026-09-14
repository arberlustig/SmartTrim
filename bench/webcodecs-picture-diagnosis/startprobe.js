// Where the owner's 1.6-2.5 s between sound and first picture goes. Plays SourceTrack 5 once in the window as it is
// and records a timeline of the picture's start, plus the clock the picture reads (getOutputTimestamp) against
// currentTime. globalThis.__clickToPlayMs: how long after a click on the waveform the play button is pressed.
// Browser functions are wrapped for the run only.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (number) =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${number}`);
// globalThis.__row: which SourceTrack's row to play; the owner gave SourceTrack 1 its role.
const rowNumber = globalThis.__row ?? 5;
const waveform = () => row(rowNumber).querySelector("canvas");
const playButton = () => row(rowNumber).querySelector("button.play");
const picture = document.getElementById("pictureCanvas");
if (playButton().textContent.includes("■")) {
  playButton().click();
  await wait(500);
}

let t0 = performance.now();
const at = () => Math.round(performance.now() - t0);
const timeline = [];
const once = new Set();
const mark = (what, detail = "") => timeline.push(`${at()}:${what}${detail ? ` ${detail}` : ""}`);
const first = (what, detail) => {
  if (once.has(what)) return;
  once.add(what);
  mark(what, detail);
};

let context = null;
let soundStartedAt = null;
const clockSamples = [];
const originals = {
  getOutputTimestamp: AudioContext.prototype.getOutputTimestamp,
  start: AudioBufferSourceNode.prototype.start,
  VideoDecoder: window.VideoDecoder,
  createImageBitmap: window.createImageBitmap,
  drawImage: CanvasRenderingContext2D.prototype.drawImage,
};
AudioContext.prototype.getOutputTimestamp = function () {
  context = this;
  const stamp = originals.getOutputTimestamp.call(this);
  if (clockSamples.length < 400) {
    clockSamples.push({
      at: at(),
      pictureClock: soundStartedAt === null ? null : stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000 - soundStartedAt,
      soundClock: soundStartedAt === null ? null : this.currentTime - soundStartedAt,
      stampAgeMs: Math.round(performance.now() - stamp.performanceTime),
    });
  }
  return stamp;
};
AudioBufferSourceNode.prototype.start = function (when, ...rest) {
  soundStartedAt = when;
  mark(
    "sound scheduled",
    `when=${when.toFixed(3)} currentTime=${this.context.currentTime.toFixed(3)} state=${this.context.state} baseLatency=${this.context.baseLatency} outputLatency=${this.context.outputLatency}`,
  );
  return originals.start.call(this, when, ...rest);
};
window.VideoDecoder = class extends originals.VideoDecoder {
  constructor(init) {
    super({
      output: (frame) => {
        first("first frame out", `timestamp=${frame.timestamp}`);
        init.output(frame);
      },
      error: (error) => {
        mark("decoder error", String(error?.message ?? error));
        init.error(error);
      },
    });
    mark("decoder made");
  }
  configure(config) {
    mark("decoder configured");
    return super.configure(config);
  }
  decode(chunk) {
    first("first chunk decoded", `timestamp=${chunk.timestamp} type=${chunk.type}`);
    return super.decode(chunk);
  }
  flush() {
    mark("flush");
    return super.flush();
  }
};
window.createImageBitmap = function (...args) {
  return originals.createImageBitmap.apply(this, args).then((image) => {
    first("first copy ready");
    return image;
  });
};
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas === picture) first("first picture drawn");
  return originals.drawImage.apply(this, args);
};

try {
  const box = waveform().getBoundingClientRect();
  const x = box.left + box.width * (globalThis.__clickFraction ?? 0.4);
  t0 = performance.now();
  mark("click");
  waveform().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: box.top + 5 }));
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: box.top + 5 }));
  await wait(globalThis.__clickToPlayMs ?? 1500);
  mark("play pressed");
  playButton().click();
  await wait(5000);
  mark("stop pressed");
  playButton().click();
  await wait(300);
} finally {
  AudioContext.prototype.getOutputTimestamp = originals.getOutputTimestamp;
  AudioBufferSourceNode.prototype.start = originals.start;
  window.VideoDecoder = originals.VideoDecoder;
  window.createImageBitmap = originals.createImageBitmap;
  CanvasRenderingContext2D.prototype.drawImage = originals.drawImage;
}

// The clock the picture reads, against the sound's own clock, at a few moments after the sound was scheduled.
const pick = clockSamples.filter((sample) => sample.pictureClock !== null);
const every = Math.max(1, Math.floor(pick.length / 8));
return {
  clickToPlayMs: globalThis.__clickToPlayMs ?? 1500,
  timeline,
  pictureClockVersusSound: pick
    .filter((_, index) => index % every === 0)
    .map((sample) => `${sample.at}ms picture ${sample.pictureClock.toFixed(3)} sound ${sample.soundClock.toFixed(3)} stampAge ${sample.stampAgeMs}ms`),
  zoom: document.getElementById("zoomValue")?.textContent,
  skip: document.getElementById("skipRemoved").checked,
};
