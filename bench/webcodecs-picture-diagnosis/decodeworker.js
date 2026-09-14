// Does decoding in a worker escape the ~60 frames a second the window's own decoder is held to while it animates?
// Loads bench/probe-decode-worker.js from the dev server and decodes the same real frames there: idle, and while a
// canvas is redrawn every animation frame. The page's own decoder is measured beside it for comparison.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tabId = globalThis.__tabId ?? 1;
const still = await window.smarttrim.stillPicture(tabId, globalThis.__stillSeconds ?? 699);
if (!still.ok) return still.message;
const { decoder: config, feed } = still.value;
const bytes = [];
for (let at = 0; at < feed.length; at += 30) {
  const answer = await window.smarttrim.readFrames(tabId, feed.slice(at, at + 30));
  if (!answer.ok) return answer.message;
  bytes.push(...answer.value);
}
const decoderConfig = {
  codec: config.codec,
  description: config.description,
  codedWidth: 1920,
  codedHeight: 1080,
  optimizeForLatency: true,
  hardwareAcceleration: "prefer-hardware",
};
const chunks = () =>
  feed.map((frame, index) => ({ type: frame.key ? "key" : "delta", timestamp: frame.pts, data: bytes[index].slice() }));

let worker;
try {
  worker = new Worker(globalThis.__workerUrl, { type: "module" });
} catch (error) {
  return `worker refused: ${error}`;
}
const inWorker = () =>
  new Promise((resolve) => {
    worker.onmessage = ({ data }) => resolve(data);
    worker.onerror = (event) => resolve({ error: event.message ?? "worker error" });
    worker.postMessage({ config: decoderConfig, chunks: chunks() });
  });
async function inPage() {
  let out = 0;
  const decoder = new VideoDecoder({ output: (frame) => { out += 1; frame.close(); }, error: () => undefined });
  decoder.configure(decoderConfig);
  const started = performance.now();
  for (const chunk of chunks()) decoder.decode(new EncodedVideoChunk(chunk));
  await decoder.flush();
  const seconds = (performance.now() - started) / 1000;
  decoder.close();
  return { out, framesPerSecond: Math.round(out / seconds) };
}

const results = { frames: feed.length, workerIdle: await inWorker(), pageIdle: await inPage() };

const canvas = document.createElement("canvas");
canvas.width = 1600;
canvas.height = 200;
canvas.style.cssText = "position:fixed;left:0;bottom:0;width:800px;height:100px;opacity:0.01;pointer-events:none";
document.body.append(canvas);
let looping = true;
const paint = () => {
  const context = canvas.getContext("2d");
  context.fillStyle = `hsl(${performance.now() % 360},50%,50%)`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (looping) requestAnimationFrame(paint);
};
requestAnimationFrame(paint);
await wait(300);
results.workerWhileAnimating = await inWorker();
results.pageWhileAnimating = await inPage();
looping = false;
canvas.remove();
worker.terminate();
return results;
