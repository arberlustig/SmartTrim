// One play of SourceTrack 5 from a zoomed-in view, picture on or folded (globalThis.__keepFolded), with the window's
// lateness split by phase: waiting for the sound, copying it into the AudioBuffer (createBuffer until start), and the
// first 1.5 s after the sound starts, when the picture starts too. Meant to be run many times, alternating.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (number) =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${number}`);
const waveform = () => row(5).querySelector("canvas");
const playButton = () => row(5).querySelector("button.play");
function clickAt(fraction) {
  const box = waveform().getBoundingClientRect();
  const x = box.left + box.width * fraction;
  waveform().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: box.top + 5 }));
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: box.top + 5 }));
}
async function wheel(times, deltaY) {
  const box = waveform().getBoundingClientRect();
  for (let turn = 0; turn < times; turn++) {
    waveform().dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, clientX: box.left + box.width * 0.4, clientY: box.top + 5 }),
    );
    await wait(60);
  }
}

const keepFolded = globalThis.__keepFolded === true;
if (document.getElementById("pictureFrame").hidden !== keepFolded) document.getElementById("pictureToggle").click();
await wheel(30, 100);
await wheel(8, -100);
await wait(300);
clickAt(0.2 + Math.random() * 0.5);
await wait(1500);

const marks = {};
const createBuffer = BaseAudioContext.prototype.createBuffer;
const start = AudioBufferSourceNode.prototype.start;
BaseAudioContext.prototype.createBuffer = function (...args) {
  marks.fillStart ??= performance.now();
  return createBuffer.apply(this, args);
};
AudioBufferSourceNode.prototype.start = function (...args) {
  marks.soundStart ??= performance.now();
  return start.apply(this, args);
};

const late = [];
let ticking = true;
(async () => {
  let last = performance.now();
  while (ticking) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const now = performance.now();
    if (now - last - 5 > 30) late.push({ from: last, ms: now - last - 5 });
    last = now;
  }
})();
const pressed = performance.now();
try {
  playButton().click();
  await wait(3000);
  playButton().click();
  await wait(300);
} finally {
  ticking = false;
  BaseAudioContext.prototype.createBuffer = createBuffer;
  AudioBufferSourceNode.prototype.start = start;
}

const worstIn = (from, to) =>
  Math.round(Math.max(0, ...late.filter((entry) => entry.from >= from - 5 && entry.from < to).map((entry) => entry.ms)));
const fillStart = marks.fillStart ?? pressed;
const soundStart = marks.soundStart ?? fillStart;
return {
  folded: keepFolded,
  waitForSoundMs: Math.round(fillStart - pressed),
  fillMs: Math.round(soundStart - fillStart),
  lateWhileWaitingMs: worstIn(pressed, fillStart),
  lateWhileFillingMs: worstIn(fillStart, soundStart + 1),
  lateFirst1500msAfterSoundMs: worstIn(soundStart + 1, soundStart + 1500),
  lateLaterMs: worstIn(soundStart + 1500, pressed + 3000),
};
