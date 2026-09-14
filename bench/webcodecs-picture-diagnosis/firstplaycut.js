// What stalled the main process for about 2 s: a fresh Tab of the 25-minute capture, SourceTrack 5 given its role, a still frame, the
// first play, a cut, a still frame after the cut, a play skipping what the cut removes. An IPC ping every 25 ms and the
// picture's draws are timed on one clock, so each stall can be matched to the step that caused it.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const t0 = performance.now();
const at = () => Math.round(performance.now() - t0);
const row = (number) =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${number}`);
const waveform = () => row(5).querySelector("canvas");
const playButton = () => row(5).querySelector("button.play");
const picture = document.getElementById("pictureCanvas");
const steps = [];
const step = (name) => steps.push(`${at()}:${name}`);

const draws = [];
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas === picture) draws.push(at());
  return drawImage.apply(this, args);
};
const stalls = [];
let pinging = true;
(async () => {
  while (pinging) {
    const sent = performance.now();
    await window.smarttrim.readFrames(globalThis.__tabId ?? 1, []);
    const roundTrip = performance.now() - sent;
    if (roundTrip > 50) stalls.push(`${Math.round(sent - t0)}:${Math.round(roundTrip)}`);
    await wait(25);
  }
})();
function clickAt(fraction) {
  const box = waveform().getBoundingClientRect();
  const x = box.left + box.width * fraction;
  waveform().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: box.top + 5 }));
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: box.top + 5 }));
}
/** How long after `since` the picture was next drawn. */
const nextDrawAfter = (since) => {
  const drawn = draws.find((time) => time > since);
  return drawn === undefined ? null : drawn - since;
};

try {
  if (document.getElementById("pictureFrame").hidden) document.getElementById("pictureToggle").click();
  const select = row(5).querySelector("select");
  step("role");
  select.value = "voice";
  select.dispatchEvent(new Event("change"));
  let waited = Date.now();
  while (!waveform() && Date.now() - waited < 60_000) await wait(50);
  step("waveform shown");
  await wait(1500);

  const firstClick = at();
  step("click");
  clickAt(0.39);
  await wait(2000);
  const firstStillMs = nextDrawAfter(firstClick);

  step("play");
  playButton().click();
  await wait(3000);
  step("stop");
  playButton().click();
  await wait(1000);

  step("cut");
  document.getElementById("cut").click();
  waited = Date.now();
  while (document.getElementById("result").hidden && Date.now() - waited < 120_000) await wait(20);
  step("cut shown");
  await wait(300);

  const clickAfterCut = at();
  step("click after cut");
  clickAt(0.67);
  await wait(3000);
  const stillAfterCutMs = nextDrawAfter(clickAfterCut);

  document.getElementById("skipRemoved").checked = true;
  step("play skipping");
  playButton().click();
  await wait(4000);
  step("stop");
  playButton().click();
  await wait(500);
  return { steps: steps.join("  "), ipcStalls: stalls.join(" "), firstStillMs, stillAfterCutMs };
} finally {
  pinging = false;
  CanvasRenderingContext2D.prototype.drawImage = drawImage;
}
