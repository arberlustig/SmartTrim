// Brings a freshly started window (DevTools port 9223) to where the acceptance runs start: recorder and pings
// installed, a Recording open, SourceTrack 5 cutting with the Gaming preset, cut.
//   node bench/picture-acceptance/setup.mjs ["<Recording>"] [--no-cut]
import { readFileSync } from "node:fs";

const recording = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "C:/Users/user/Downloads/capture-25min.mp4";
const cut = !process.argv.includes("--no-cut");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let page = null;
for (let attempt = 0; attempt < 120 && !page; attempt++) {
  try {
    page = (await (await fetch("http://127.0.0.1:9223/json")).json()).find((target) => target.type === "page") ?? null;
  } catch {
    // Not listening yet.
  }
  if (!page) await sleep(500);
}
if (!page) throw new Error("no window on port 9223");
const socket = new WebSocket(page.webSocketDebuggerUrl);
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
const run = async (body) =>
  (await send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (condition, seconds) => {
  for (let at = 0; at < seconds * 2; at++) {
    if (await run(`return ${condition};`)) return true;
    await sleep(500);
  }
  return false;
};

await waitFor("document.getElementById('chooseRecording') !== null && !document.getElementById('chooseRecording').disabled", 60);
const here = new URL(".", import.meta.url);
console.log("recorder", await run(readFileSync(new URL("./recorder.js", here), "utf8")));
console.log("pings", await run(readFileSync(new URL("./pings.js", here), "utf8")));
const data = { items: [], files: [recording], dragOperationsMask: 1 };
for (const type of ["dragEnter", "dragOver", "drop"]) await send("Input.dispatchDragEvent", { type, x: 300, y: 300, data });
await waitFor("document.querySelectorAll('#sourceTracks .row').length > 0", 60);
if (cut) {
  await run(
    "const row = [...document.querySelectorAll('#sourceTracks .row')].find((r) => r.textContent.includes('Tonspur 5')); const select = row.querySelector('select'); select.value = 'voice'; select.dispatchEvent(new Event('change', { bubbles: true }));",
  );
  await sleep(1000);
  await waitFor("!document.getElementById('cut').disabled", 120);
  await run("document.getElementById('cut').click();");
  await waitFor("document.querySelectorAll('button.play').length > 0 && !document.getElementById('skipRow').hidden && !document.getElementById('cut').disabled", 120);
}
console.log(
  await run(
    "return { visible: document.visibilityState, numbers: [...document.querySelectorAll('.numbers')].map((n) => n.textContent.trim()), plays: document.querySelectorAll('button.play').length };",
  ),
);
socket.close();
