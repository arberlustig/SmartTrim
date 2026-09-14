// One line of memory: the main process over its V8 inspector (9229), the window over DevTools (9223).
async function evaluate(listUrl, pick, expression) {
  const targets = await (await fetch(listUrl)).json();
  const socket = new WebSocket(pick(targets).webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve));
  const answer = await new Promise((resolve) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) resolve(message);
    });
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
  socket.close();
  return answer.result?.result?.value;
}
const mb = (bytes) => Math.round(bytes / 1e6);
const main = await evaluate("http://127.0.0.1:9229/json", (t) => t[0], "process.memoryUsage()");
const window = await evaluate(
  "http://127.0.0.1:9223/json",
  (t) => t.find((x) => x.type === "page"),
  "({ used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize })",
);
console.log(
  `memory: main rss ${mb(main.rss)} heapUsed ${mb(main.heapUsed)} heapTotal ${mb(main.heapTotal)} external ${mb(main.external)} arrayBuffers ${mb(main.arrayBuffers)} | window heap used ${mb(window.used)} total ${mb(window.total)}`,
);
