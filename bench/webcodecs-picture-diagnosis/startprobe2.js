// Second probe of the picture's late start, per decoder. Plays one row once (globalThis.__row, default 1) after a click
// (globalThis.__clickToPlayMs) and records, for every VideoDecoder the window makes, when it was fed, how full its queue
// was and when it gave frames back; every image copy's duration; the first frames drawn. Times are relative to the
// sound being scheduled. Browser functions are wrapped for the run only.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rowNumber = globalThis.__row ?? 1;
const row = () =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${rowNumber}`);
const waveform = () => row().querySelector("canvas");
const playButton = () => row().querySelector("button.play");
const picture = document.getElementById("pictureCanvas");
if (playButton().textContent.includes("■")) {
  playButton().click();
  await wait(500);
}

let t0 = performance.now();
let soundAt = null;
const since = () => Math.round(performance.now() - (soundAt ?? t0));
const decoders = [];
const copies = [];
const draws = [];
const originals = {
  start: AudioBufferSourceNode.prototype.start,
  VideoDecoder: window.VideoDecoder,
  createImageBitmap: window.createImageBitmap,
  drawImage: CanvasRenderingContext2D.prototype.drawImage,
};
AudioBufferSourceNode.prototype.start = function (...args) {
  soundAt = performance.now();
  return originals.start.apply(this, args);
};
window.VideoDecoder = class extends originals.VideoDecoder {
  constructor(init) {
    const record = {
      made: null,
      config: "",
      decodes: 0,
      decodeTimes: [],
      maxQueue: 0,
      firstChunk: "",
      outputs: 0,
      outputTimes: [],
      flushes: [],
      closed: null,
      soundScheduledBefore: false,
    };
    super({
      output: (frame) => {
        record.outputs += 1;
        if (record.outputs <= 5 || record.outputs % 30 === 0) record.outputTimes.push(`${since()}#${record.outputs}(pts ${frame.timestamp})`);
        init.output(frame);
      },
      error: (error) => {
        record.flushes.push(`error ${since()} ${error?.message}`);
        init.error(error);
      },
    });
    record.made = since();
    record.soundScheduledBefore = soundAt !== null;
    this.record = record;
    decoders.push(record);
  }
  configure(config) {
    this.record.config = `${config.hardwareAcceleration} ${config.codedWidth}x${config.codedHeight} latency=${config.optimizeForLatency}`;
    return super.configure(config);
  }
  decode(chunk) {
    const record = this.record;
    record.decodes += 1;
    record.maxQueue = Math.max(record.maxQueue, this.decodeQueueSize);
    if (record.decodes === 1) record.firstChunk = `${chunk.type} pts ${chunk.timestamp} at ${since()}`;
    if (record.decodes <= 3 || record.decodes % 30 === 0) record.decodeTimes.push(`${since()}#${record.decodes}(q${this.decodeQueueSize})`);
    return super.decode(chunk);
  }
  flush() {
    this.record.flushes.push(`flush ${since()} after ${this.record.decodes} decodes`);
    return super.flush();
  }
  close() {
    this.record.closed = since();
    return super.close();
  }
};
window.createImageBitmap = function (...args) {
  const asked = performance.now();
  const askedAt = since();
  return originals.createImageBitmap.apply(this, args).then((image) => {
    if (copies.length < 12) copies.push(`${askedAt}+${Math.round(performance.now() - asked)}ms`);
    return image;
  });
};
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas === picture && draws.length < 8) draws.push(since());
  return originals.drawImage.apply(this, args);
};

try {
  const box = waveform().getBoundingClientRect();
  const x = box.left + box.width * (globalThis.__clickFraction ?? 0.4);
  t0 = performance.now();
  waveform().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: box.top + 5 }));
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: box.top + 5 }));
  await wait(globalThis.__clickToPlayMs ?? 1500);
  const pressed = performance.now();
  playButton().click();
  await wait(5000);
  playButton().click();
  await wait(300);
  return {
    clickToPlayMs: globalThis.__clickToPlayMs ?? 1500,
    pressToSoundMs: soundAt === null ? null : Math.round(soundAt - pressed),
    visible: document.visibilityState,
    decoders: decoders.map((record, index) => ({ index, ...record, decodeTimes: record.decodeTimes.join(" "), outputTimes: record.outputTimes.join(" ") })),
    copies: copies.join(" "),
    drawsMsAfterSound: draws.join(" "),
  };
} finally {
  AudioBufferSourceNode.prototype.start = originals.start;
  window.VideoDecoder = originals.VideoDecoder;
  window.createImageBitmap = originals.createImageBitmap;
  CanvasRenderingContext2D.prototype.drawImage = originals.drawImage;
}
