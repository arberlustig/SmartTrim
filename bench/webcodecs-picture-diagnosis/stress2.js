// Realistic use for the recorder: fast clicks, dragging and wheel-zooming the waveform, playing zoomed in, folding the
// picture while playing, cutting, jumping while playing, quick play/stop. Needs the 25-minute capture open and recorder.js installed.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (number) =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${number}`);
const waveform = () => row(5).querySelector("canvas");
const play = () => row(5).querySelector("button.play").click();
let seed = 777;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

function pointer(type, fraction, target = window) {
  const box = waveform().getBoundingClientRect();
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: box.left + box.width * fraction, clientY: box.top + 5 }));
}
function clickAt(fraction) {
  pointer("pointerdown", fraction, waveform());
  pointer("pointerup", fraction);
}
async function drag(from, to, steps = 20) {
  pointer("pointerdown", from, waveform());
  for (let step = 1; step <= steps; step++) {
    pointer("pointermove", from + ((to - from) * step) / steps);
    await wait(20);
  }
  pointer("pointerup", to);
}
async function wheel(times, deltaY, fraction = 0.5) {
  const box = waveform().getBoundingClientRect();
  for (let turn = 0; turn < times; turn++) {
    waveform().dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, clientX: box.left + box.width * fraction, clientY: box.top + 5 }),
    );
    await wait(100);
  }
}

const select = row(5).querySelector("select");
if (select.value !== "voice") {
  select.value = "voice";
  select.dispatchEvent(new Event("change"));
}
let waited = Date.now();
while (!waveform() && Date.now() - waited < 60_000) await wait(100);
// globalThis.__keepFolded: the whole run with the picture folded away, so nothing is decoded — the differential case.
const keepFolded = globalThis.__keepFolded === true;
const toggle = () => {
  if (!keepFolded) document.getElementById("pictureToggle").click();
};
if (document.getElementById("pictureFrame").hidden !== keepFolded) document.getElementById("pictureToggle").click();

clickAt(0.2);
await wait(1200);
play();
await wait(4000);
play();
await wait(600);

for (let click = 0; click < 20; click++) {
  clickAt(0.05 + random() * 0.9);
  await wait(120);
}
await wait(1500);
await drag(0.6, 0.3);
await wait(500);

await wheel(8, -100, 0.4);
await wait(300);
clickAt(0.3);
await wait(1000);
play();
await wait(2500);
await wheel(4, 100, 0.5);
await drag(0.5, 0.7);
await wait(1000);
toggle();
await wait(800);
toggle();
await wait(3000);
play();
await wait(600);
await wheel(20, 100, 0.5);

document.getElementById("cut").click();
waited = Date.now();
while (document.getElementById("result").hidden && Date.now() - waited < 120_000) await wait(100);
document.getElementById("skipRemoved").checked = true;
await wait(800);
clickAt(0.387);
await wait(1200);
play();
await wait(2000);
for (let jump = 0; jump < 5; jump++) {
  clickAt(0.05 + random() * 0.9);
  await wait(800);
}
await wait(4000);
play();
await wait(600);

for (let press = 0; press < 6; press++) {
  play();
  await wait(250);
}
await wait(1500);
if (row(5).querySelector("button.play").textContent.includes("■")) play();
clickAt(0.671);
await wait(1200);
play();
await wait(6000);
play();
return "done";
