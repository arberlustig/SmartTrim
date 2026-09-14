// What exactly paces the hardware decoder to ~60 frames a second while the window animates. Same real frames as
// decoderate.js, decoded without throttling, nothing playing: (C) a canvas redrawn every animation frame, the control;
// (E) an animation-frame loop that draws nothing; (F) a canvas redrawn by a 16 ms timer, no animation-frame loop;
// (J) the animated canvas again, decoder configured with optimizeForLatency false.
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
const configFor = (optimizeForLatency) => ({
  codec: config.codec,
  description: config.description,
  codedWidth: 1920,
  codedHeight: 1080,
  optimizeForLatency,
  hardwareAcceleration: "prefer-hardware",
});

async function decodeAll(optimizeForLatency = true) {
  let out = 0;
  const decoder = new VideoDecoder({ output: (frame) => { out += 1; frame.close(); }, error: () => undefined });
  decoder.configure(configFor(optimizeForLatency));
  const started = performance.now();
  for (let index = 0; index < feed.length; index++) {
    decoder.decode(new EncodedVideoChunk({ type: feed[index].key ? "key" : "delta", timestamp: feed[index].pts, data: bytes[index] }));
  }
  await decoder.flush();
  const seconds = (performance.now() - started) / 1000;
  decoder.close();
  return Math.round(out / seconds);
}

const canvas = document.createElement("canvas");
canvas.width = 1600;
canvas.height = 200;
canvas.style.cssText = "position:fixed;left:0;bottom:0;width:800px;height:100px;opacity:0.01;pointer-events:none";
document.body.append(canvas);
const paintOnce = () => {
  const context = canvas.getContext("2d");
  context.fillStyle = `hsl(${performance.now() % 360},50%,50%)`;
  context.fillRect(0, 0, canvas.width, canvas.height);
};

async function whileRunning(start, stop) {
  start();
  await wait(300);
  const framesPerSecond = await decodeAll();
  stop();
  await wait(300);
  return framesPerSecond;
}

const results = { frames: feed.length, idleBefore: await decodeAll() };

let looping = false;
const drawingLoop = () => {
  paintOnce();
  if (looping) requestAnimationFrame(drawingLoop);
};
results.C_canvasEveryAnimationFrame = await whileRunning(
  () => { looping = true; requestAnimationFrame(drawingLoop); },
  () => { looping = false; },
);

const emptyLoop = () => {
  if (looping) requestAnimationFrame(emptyLoop);
};
results.E_emptyAnimationFrameLoop = await whileRunning(
  () => { looping = true; requestAnimationFrame(emptyLoop); },
  () => { looping = false; },
);

let interval = 0;
results.F_canvasByTimerNoAnimationFrames = await whileRunning(
  () => { interval = setInterval(paintOnce, 16); },
  () => clearInterval(interval),
);

looping = true;
requestAnimationFrame(drawingLoop);
await wait(300);
results.J_canvasEveryAnimationFrame_optimizeForLatencyFalse = await decodeAll(false);
looping = false;
await wait(300);

canvas.remove();
results.idleAfter = await decodeAll();
return results;
