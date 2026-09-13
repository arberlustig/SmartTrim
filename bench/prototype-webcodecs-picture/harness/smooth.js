// Feedback loop for "the picture is still too choppy". Needs the 25-minute capture open in the Tab on screen, window visible.
// globalThis.__startFraction: where the Playhead goes (0..1); globalThis.__skip: skip removed parts;
// globalThis.__flags: { noRedraw, noPreseek } for the tagged debug switches in the window.
// Counts the frames the picture on screen really presented (requestVideoFrameCallback's presentedFrames), and every gap
// between two shown frames longer than 50 ms, which is what the eye reads as a stutter.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (number) =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${number}`);
const videos = [document.getElementById("pictureA"), document.getElementById("pictureB")];
const debug = globalThis.__debug9b1d;
Object.assign(debug.flags, { noRedraw: false, noPreseek: false }, globalThis.__flags ?? {});

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
const canvas = row(5).querySelector("canvas");
const box = canvas.getBoundingClientRect();
const x = box.left + box.width * (globalThis.__startFraction ?? 0.1905);
canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: box.top + 5 }));
window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: box.top + 5 }));
await wait(1500);

const shown = [];
let measuring = true;
for (const video of videos) {
  const onFrame = (now, meta) => {
    shown.push({ now, id: video.id, front: video.classList.contains("front"), presented: meta.presentedFrames, media: meta.mediaTime });
    if (measuring) video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}
let hiddenAtAnyPoint = false;
const offs = [];
row(5).querySelector("button.play").click();
started = performance.now();
while (performance.now() - started < 8000) {
  if (document.visibilityState !== "visible") hiddenAtAnyPoint = true;
  await wait(50);
  const sound = debug.sound();
  // How far the picture on screen is behind (negative) or ahead of the sound, once it has started.
  if (sound && performance.now() - started > 500) offs.push(document.getElementById(sound.front).currentTime - sound.heard);
}
measuring = false;
row(5).querySelector("button.play").click();

// From the first frame shown after pressing play plus half a second (the start is not what the owner means).
const from = started + 500;
const to = started + 8000;
const visible = shown.filter((frame) => frame.front && frame.now >= from && frame.now <= to).sort((a, b) => a.now - b.now);
let frames = 0;
const gaps = [];
for (let at = 1; at < visible.length; at++) {
  const before = visible[at - 1];
  const frame = visible[at];
  const sameElement = before.id === frame.id;
  const newFrames = sameElement ? frame.presented - before.presented : 1;
  frames += Math.max(newFrames, 0);
  const gap = frame.now - before.now;
  // A long gap with several frames presented in it is a callback that came late, not a picture that stood still.
  if (gap > 50 && newFrames <= 2) gaps.push({ at: Math.round(frame.now - started), ms: Math.round(gap), swap: !sameElement });
}
const seconds = (to - from) / 1000;
return {
  hidden: hiddenAtAnyPoint,
  flags: { ...debug.flags },
  skip: globalThis.__skip ?? true,
  framesPerSecond: Math.round(frames / seconds),
  gapsOver50ms: gaps.length,
  gapsOver150ms: gaps.filter((gap) => gap.ms > 150).length,
  longestGapMs: Math.max(0, ...gaps.map((gap) => gap.ms)),
  gapsAtSwaps: gaps.filter((gap) => gap.swap).length,
  offMedianMs: Math.round(([...offs].sort((a, b) => a - b)[Math.floor(offs.length / 2)] ?? 0) * 1000),
  offWorstMs: Math.round(Math.max(0, ...offs.map((off) => Math.abs(off))) * 1000),
  gaps: gaps.map((gap) => `${gap.at}ms:${gap.ms}${gap.swap ? "S" : ""}`).join(" "),
};
