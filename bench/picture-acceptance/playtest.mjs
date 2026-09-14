// Scripted plays for the picture's acceptance, with real mouse events over the DevTools protocol: put the Playhead at
// each place by clicking the first waveform (zoomed out on the whole Recording), press ▶, let it play, press ■. The
// recorder keeps what happened; report.js reads it.
//   TOTAL_SECONDS=1513.9833 node bench/picture-acceptance/playtest.mjs [seconds ...]
// TOTAL_SECONDS is the Recording's length (the 25-minute capture 1513.9833, the long Recording 9111.5333). PLAY_MS sets how long each play lasts,
// FOLD=1 folds the picture away first — the baseline, with no frames made.
const totalSeconds = Number(process.env.TOTAL_SECONDS);
if (!totalSeconds) throw new Error("TOTAL_SECONDS must be the Recording's length");
const places = process.argv.slice(2).map(Number);
const stretches = places.length ? places : [289.1, 585.9, 1016.4];
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
// The picture pushes the waveforms below the fold of a 760 px window, and mouse events outside the viewport hit nothing,
// so every target is scrolled into the middle first.
const rectOf = (selector) =>
  evaluate(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: "center", behavior: "instant" }); const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`,
  );

const wantOpen = !process.env.FOLD;
await evaluate(`(document.getElementById('pictureFrame').hidden === ${wantOpen}) && (document.getElementById('pictureToggle').click(), true)`);
for (const seconds of stretches) {
  const box = await rectOf(".waveform canvas");
  await click(box.left + (seconds / totalSeconds) * box.width, box.top + box.height / 2);
  await sleep(1500);
  const button = await rectOf("button.play");
  await click(button.left + button.width / 2, button.top + button.height / 2);
  await sleep(playMs);
  const stop = await rectOf("button.play");
  await click(stop.left + stop.width / 2, stop.top + stop.height / 2);
  await sleep(2000);
  console.log({ played: seconds });
}
socket.close();
