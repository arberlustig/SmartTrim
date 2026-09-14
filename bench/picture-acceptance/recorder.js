// Passive recorder for the picture (ADR-0028). Installed once per page load over CDP, it records what the window does —
// scripted or by hand — until report.js reads it: every frame put on the picture's canvas, when each sound becomes
// audible, presses, late and long animation frames. Browser functions are wrapped in the page only; the product has
// no hooks for this.
//   node bench/picture-acceptance/cdp.mjs evalfile bench/picture-acceptance/recorder.js
if (window.__recorder) {
  // Installed already: start a fresh recording without wrapping anything a second time.
  const old = window.__recorder;
  old.t0 = performance.now();
  for (const list of [old.events, old.draws, old.lateAnimationFrames, old.longFrames, old.pingSpikes, old.timerSpikes]) {
    list.length = 0;
  }
  return "reset";
}
const picture = document.getElementById("pictureCanvas");
const r = { t0: performance.now(), events: [], draws: [], lateAnimationFrames: [], longFrames: [], pingSpikes: [], timerSpikes: [] };
window.__recorder = r;
const now = () => Math.round(performance.now() - r.t0);
const note = (what, detail) => r.events.push({ at: now(), what, detail });

// The product draws a frame only when the frame due changes, so every draw is a new frame on screen.
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas === picture) r.draws.push(performance.now() - r.t0);
  return drawImage.apply(this, args);
};

// When a sound becomes audible: the moment it is scheduled for, carried to the page's clock through the output timestamp.
const soundStart = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (...args) {
  const context = this.context;
  const when = args[0] ?? context.currentTime;
  const stamp = context.getOutputTimestamp();
  const audibleAt = stamp.performanceTime
    ? stamp.performanceTime + (when - stamp.contextTime) * 1000
    : performance.now() + (when - context.currentTime) * 1000;
  note("soundStart", { audibleAt: Math.round(audibleAt - r.t0), folded: document.getElementById("pictureFrame").hidden });
  return soundStart.apply(this, args);
};
const soundStop = AudioBufferSourceNode.prototype.stop;
AudioBufferSourceNode.prototype.stop = function (...args) {
  note("soundStop");
  return soundStop.apply(this, args);
};

// Where a press on a canvas went down, so its release can tell a click (the Playhead moves) from a drag (the view pans).
let pressed = null;
document.addEventListener(
  "pointerdown",
  (event) => {
    const canvas = event.target.closest?.("canvas");
    if (!canvas) return;
    const where = canvas.closest(".waveform") ? "waveform" : canvas.id || "canvas";
    pressed = { where, x: event.clientX };
    note("pointerdown", where);
  },
  true,
);
// The window puts the Playhead down when the button is let go, so a still frame is timed from here.
window.addEventListener(
  "pointerup",
  (event) => {
    if (!pressed) return;
    note("pointerup", { where: pressed.where, travel: Math.round(Math.abs(event.clientX - pressed.x)) });
    pressed = null;
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

// Animation frames later than 50 ms after the one before: the window's thread was busy.
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
return "installed";
