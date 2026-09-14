// PROTOTYPE, throwaway: a scripted self-check of the JPEG picture before the owner's own session. Real mouse events over
// the DevTools protocol: put the Playhead at each dense stretch of the owner's cut by clicking the first waveform, press
// ▶, let it play, press ■. The recorder and the prototype log keep what happened; report.js reads it.
//   node bench/prototype-jpeg-picture/playtest.mjs [seconds ...]      (default: 289.1 585.9 1016.4)
const targets = process.argv.slice(2).map(Number);
const stretches = targets.length ? targets : [289.1, 585.9, 1016.4];
const playMs = Number(process.env.PLAY_MS ?? 12000);

const pages = await (await fetch("http://127.0.0.1:9223/json")).json();
const socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve));
let lastId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    lastId += 1;
    pending.set(lastId, resolve);
    socket.send(JSON.stringify({ id: lastId, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function click(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
// The picture pushes the waveforms below the fold of the owner's 760 px window, so every target is scrolled into the
// middle first; mouse events outside the viewport hit nothing.
const rectOf = (selector) =>
  evaluate(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: "center", behavior: "instant" }); const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`,
  );
const stillCount = () => evaluate("window.__proto.events.filter((e) => e.what === 'still').length");
const lastStill = () => evaluate("(window.__proto.events.filter((e) => e.what === 'still').at(-1) ?? null)");
async function newStill(before, ms) {
  for (let waited = 0; waited < ms; waited += 50) {
    if ((await stillCount()) > before) return lastStill();
    await sleep(50);
  }
  return null;
}

// How long the Recording is, read off the still frame a click in the middle of the whole-Recording waveform puts
// there. (A click at the very right edge lands past the last frame, where no still frame exists.)
// TOTAL_SECONDS skips this; FOLD=1 folds the picture away first (the baseline: no frames made, sound as on main).
let totalSeconds = process.env.TOTAL_SECONDS ? Number(process.env.TOTAL_SECONDS) : null;
if (!totalSeconds) {
  const canvas = await rectOf(".waveform canvas");
  const before = await stillCount();
  await click(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2);
  const middle = await newStill(before, 5000);
  totalSeconds = middle ? ((middle.frame + 0.5) / 60) * 2 : null;
  console.log({ totalSeconds, stillInMiddleMs: middle?.ms });
  if (!totalSeconds) process.exit(1);
}
const wantOpen = !process.env.FOLD;
await evaluate(`(document.getElementById('pictureFrame').hidden === ${wantOpen}) && (document.getElementById('pictureToggle').click(), true)`);

for (const seconds of stretches) {
  const box = await rectOf(".waveform canvas");
  await click(box.left + (seconds / totalSeconds) * box.width, box.top + box.height / 2);
  await sleep(1500);
  const still = await lastStill();
  const button = await rectOf("button.play");
  await click(button.left + button.width / 2, button.top + button.height / 2);
  await sleep(playMs);
  const stop = await rectOf("button.play");
  await click(stop.left + stop.width / 2, stop.top + stop.height / 2);
  await sleep(2000);
  console.log({ target: seconds, stillFrameSeconds: still ? Math.round((still.frame / 60) * 10) / 10 : null, stillMs: still?.ms });
}
socket.close();
