// Drives the running SmartTrim window over the Chrome DevTools protocol.
//   node cdp.mjs eval "<expression>"      evaluates (await allowed) and prints the JSON value
//   node cdp.mjs drop <path> [<path> ...] drops real files on the window
//   node cdp.mjs shot <file.png>          saves a screenshot
import { readFileSync, writeFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find((target) => target.type === "page");
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

if (command === "eval" || command === "evalfile") {
  const source = command === "eval" ? args[0] : readFileSync(args[0], "utf8");
  const answer = await send("Runtime.evaluate", {
    expression: `(async () => { ${source.includes("return") ? source : `return (${source});`} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(JSON.stringify(answer.result?.result?.value ?? answer.result?.exceptionDetails ?? answer, null, 1));
} else if (command === "drop") {
  const data = { items: [], files: args, dragOperationsMask: 1 };
  for (const type of ["dragEnter", "dragOver", "drop"]) {
    await send("Input.dispatchDragEvent", { type, x: 300, y: 300, data });
  }
  console.log("dropped", args.length);
} else if (command === "front") {
  // Raises the window, so Windows does not report it covered and Chromium does not stop its animation frames.
  await send("Page.bringToFront");
  const answer = await send("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true });
  console.log("visibility", answer.result?.result?.value);
} else if (command === "raw") {
  // Any protocol method with JSON parameters, e.g. raw Browser.getWindowForTarget "{}".
  console.log(JSON.stringify(await send(args[0], JSON.parse(args[1] ?? "{}")), null, 1));
} else if (command === "shot") {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(args[0], Buffer.from(result.data, "base64"));
  console.log("saved", args[0]);
}
socket.close();
