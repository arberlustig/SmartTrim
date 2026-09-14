// Which Chromium switch lifts the decoder brake. Starts the built SmartTrim once per set of switches on DevTools port
// 9224, opens the 25-minute capture by a drop, runs brakemini.js in the window, prints what it measured, and closes the instance again.
//   node switches.mjs [config ...]      (default: all configs in order)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const repo = "C:/Users/user/source/repos/SmartTrim";
const electron = `${repo}/node_modules/electron/dist/electron.exe`;
const recording = "C:/Users/user/Downloads/capture-25min.mp4";
const port = 9224;
const test = readFileSync(new URL("./brakemini.js", import.meta.url), "utf8");
const occlusion = "--disable-features=CalculateNativeWinOcclusion";
const occluded = "--disable-backgrounding-occluded-windows";
const renderer = "--disable-renderer-backgrounding";
const configs = {
  none: [],
  vsyncOff: ["--disable-gpu-vsync"],
  frameRateLimitOff: ["--disable-frame-rate-limit"],
  vsyncAndFrameRateLimitOff: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
  noDirectComposition: ["--disable-direct-composition"],
  d3d12Decoder: ["--enable-features=D3D12VideoDecoder"],
  allThree: [occlusion, occluded, renderer],
  occlusionOnly: [occlusion],
  backgroundingOccludedOnly: [occluded],
  rendererBackgroundingOnly: [renderer],
};
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(configs);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === "page");
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve);
          socket.addEventListener("error", reject);
        });
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
        const evaluate = async (source) => {
          const answer = await send("Runtime.evaluate", {
            expression: `(async () => { ${source.includes("return") ? source : `return (${source});`} })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          return answer.result?.result?.value ?? answer.result?.exceptionDetails?.exception?.description ?? answer;
        };
        return { send, evaluate, close: () => socket.close() };
      }
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error("the window never came up");
}

for (const name of chosen) {
  const child = spawn(electron, [".", `--remote-debugging-port=${port}`, ...configs[name]], { cwd: repo, stdio: "ignore" });
  try {
    const page = await connect();
    await sleep(3000);
    const data = { items: [], files: [recording], dragOperationsMask: 1 };
    for (const type of ["dragEnter", "dragOver", "drop"]) await page.send("Input.dispatchDragEvent", { type, x: 300, y: 300, data });
    let rows = false;
    for (let attempt = 0; attempt < 60 && !rows; attempt++) {
      await sleep(500);
      rows = await page.evaluate("document.querySelectorAll('#sourceTracks .row').length > 0");
    }
    await sleep(2000);
    const result = rows ? await page.evaluate(test) : "no SourceTrack rows appeared";
    console.log(JSON.stringify({ config: name, switches: configs[name], result }));
    page.close();
  } catch (error) {
    console.log(JSON.stringify({ config: name, error: String(error) }));
  } finally {
    child.kill();
    await sleep(3000);
  }
}
