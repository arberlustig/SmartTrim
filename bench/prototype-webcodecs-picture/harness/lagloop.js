// Feedback loop for "the picture lags after the first Join". Needs the 25-minute capture open in the Tab on screen.
// globalThis.__startFraction: where along the waveform the Playhead is put before ▶ (0..1).
// Verdict RED when, after the first Join, the picture lies more than 0.1 s from the sound most of the time or shows
// fewer than 30 frames a second.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (number) =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${number}`);
const videos = [document.getElementById("pictureA"), document.getElementById("pictureB")];

// Preconditions: SourceTrack 5 cuts, a cut exists, skipping is on.
const select = row(5).querySelector("select");
if (select.value !== "voice") {
  select.value = "voice";
  select.dispatchEvent(new Event("change"));
}
let started = Date.now();
while (!row(5)?.querySelector("canvas") && Date.now() - started < 30_000) await wait(100);
if (document.getElementById("result").hidden) {
  document.getElementById("cut").click();
  started = Date.now();
  while (document.getElementById("result").hidden && Date.now() - started < 60_000) await wait(100);
}
document.getElementById("skipRemoved").checked = globalThis.__skip ?? true;
await wait(300);

// Put the Playhead.
const canvas = row(5).querySelector("canvas");
const box = canvas.getBoundingClientRect();
const x = box.left + box.width * (globalThis.__startFraction ?? 0.02);
canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: box.top + 5 }));
window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: box.top + 5 }));
await wait(1500);

// Instrument: seeks and presented frames per element.
const seeks = { pictureA: 0, pictureB: 0 };
const presented = { pictureA: 0, pictureB: 0 };
const onSeek = (event) => (seeks[event.target.id] += 1);
for (const video of videos) video.addEventListener("seeking", onSeek);
let measuring = true;
for (const video of videos) {
  const count = () => {
    presented[video.id] += 1;
    if (measuring) video.requestVideoFrameCallback(count);
  };
  video.requestVideoFrameCallback(count);
}
const droppedBefore = videos.map((video) => video.getVideoPlaybackQuality().droppedVideoFrames);

globalThis.__debug7c3eEvents?.();
row(5).querySelector("button.play").click();
// Animation frames the window produced: the picture logic runs on them, so none means nothing follows the sound.
let frames = 0;
const countFrame = () => {
  frames += 1;
  if (measuring) requestAnimationFrame(countFrame);
};
requestAnimationFrame(countFrame);
let lastFrames = 0;
const samples = [];
let lastFront = null;
let swaps = 0;
let lastPresented = { ...presented };
started = Date.now();
while (Date.now() - started < 8000) {
  await wait(100);
  const sound = globalThis.__debug7c3e();
  if (!sound) continue;
  const frontVideo = document.getElementById(sound.front);
  if (lastFront !== null && lastFront !== sound.front) swaps += 1;
  lastFront = sound.front;
  const fps = (presented[sound.front] - lastPresented[sound.front]) * 10;
  lastPresented = { ...presented };
  const raf = (frames - lastFrames) * 10;
  lastFrames = frames;
  samples.push({ t: Date.now() - started, swaps, off: frontVideo.currentTime - sound.heard, fps, raf, seeking: frontVideo.seeking, paused: frontVideo.paused, hidden: document.visibilityState !== "visible" });
}
measuring = false;
row(5).querySelector("button.play").click();
for (const video of videos) video.removeEventListener("seeking", onSeek);

const afterFirstJoin = samples.filter((sample) => sample.swaps > 0);
const offMost = afterFirstJoin.filter((sample) => Math.abs(sample.off) > 0.1).length;
const fpsAverage = afterFirstJoin.reduce((total, sample) => total + sample.fps, 0) / Math.max(afterFirstJoin.length, 1);
const beforeJoin = samples.filter((sample) => sample.swaps === 0);
// Stalls: tenths of a second after the first Join in which the picture on screen showed fewer than 2 frames.
const stalls = afterFirstJoin.filter((sample) => sample.fps < 20).length;
// A covered window gets no animation frames and Chromium throttles its videos: such a run says nothing about SmartTrim.
const hiddenTenths = samples.filter((sample) => sample.hidden).length;
return {
  hiddenTenths,
  verdict: hiddenTenths > 0
    ? "INVALID (window hidden)"
    : afterFirstJoin.length === 0
      ? "NO JOIN"
      : offMost > afterFirstJoin.length / 4 || fpsAverage < 30 || stalls > afterFirstJoin.length / 5
        ? "RED"
        : "GREEN",
  stalls,
  events: globalThis.__debug7c3eEvents?.() ?? [],
  // The whole run, with or without Joins: what a differential against playing without skipping compares.
  overall: {
    fpsAverage: samples.reduce((total, sample) => total + sample.fps, 0) / Math.max(samples.length, 1),
    tenthsBelow20fps: samples.filter((sample) => sample.fps < 20).length,
    animationFramesPerSecond: samples.reduce((total, sample) => total + sample.raf, 0) / Math.max(samples.length, 1),
    tenthsSeeking: samples.filter((sample) => sample.seeking).length,
    samples: samples.length,
  },
  swaps,
  seeks,
  dropped: videos.map((video, at) => video.getVideoPlaybackQuality().droppedVideoFrames - droppedBefore[at]),
  beforeJoin: { samples: beforeJoin.length, fpsAverage: beforeJoin.reduce((t, s) => t + s.fps, 0) / Math.max(beforeJoin.length, 1) },
  afterFirstJoin: { samples: afterFirstJoin.length, offBy100msOrMore: offMost, fpsAverage },
  trace: samples.map((s) => `${s.t} j${s.swaps} off=${s.off.toFixed(3)} fps=${s.fps}${s.seeking ? " SEEKING" : ""}${s.paused ? " paused" : ""}`),
};
