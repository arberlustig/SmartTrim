// The smallest step that froze the window for 556 ms: playing SourceTrack 5 of the 25-minute capture from a zoomed-in view, picture on
// (or folded with globalThis.__keepFolded). Returns every moment the window's own 5 ms timer ran more than 40 ms late.
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
clickAt(0.3);
await wait(1500);

const t0 = performance.now();
const late = [];
let ticking = true;
(async () => {
  let last = performance.now();
  while (ticking) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const now = performance.now();
    if (now - last - 5 > 40) late.push(`${Math.round(last - t0)}:${Math.round(now - last - 5)}`);
    last = now;
  }
})();
playButton().click();
await wait(3500);
playButton().click();
await wait(500);
ticking = false;
return { folded: keepFolded, windowLate: late.join(" "), pressedAtPerformanceNow: Math.round(t0) };
