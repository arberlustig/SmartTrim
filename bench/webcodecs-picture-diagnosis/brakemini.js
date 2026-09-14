// The short brake test for a freshly started window: the same real frames decoded without throttling at rest, and while
// a canvas is redrawn on every animation frame. Needs the 25-minute capture open in Tab 1.
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
const softwareConfig = { ...decoderConfig, hardwareAcceleration: "prefer-software" };
async function decodeAll(configuration = decoderConfig) {
  let out = 0;
  let failed = null;
  const decoder = new VideoDecoder({ output: (frame) => { out += 1; frame.close(); }, error: (error) => { failed = String(error?.message ?? error); } });
  decoder.configure(configuration);
  const started = performance.now();
  for (let index = 0; index < feed.length; index++) {
    decoder.decode(new EncodedVideoChunk({ type: feed[index].key ? "key" : "delta", timestamp: feed[index].pts, data: bytes[index] }));
  }
  try {
    await decoder.flush();
  } catch (error) {
    failed ??= String(error?.message ?? error);
  }
  const seconds = (performance.now() - started) / 1000;
  if (decoder.state !== "closed") decoder.close();
  return failed ? `failed after ${out} frames: ${failed}` : Math.round(out / seconds);
}

const results = { visible: document.visibilityState, frames: feed.length, idle: await decodeAll() };
// Software decoding runs outside the graphics process, so the screen's rhythm should not hold it back — if this window
// decodes HEVC in software at all.
results.softwareSupported = (await VideoDecoder.isConfigSupported(softwareConfig)).supported;
if (results.softwareSupported) results.softwareIdle = await decodeAll(softwareConfig);

const canvas = document.createElement("canvas");
canvas.width = 1600;
canvas.height = 200;
canvas.style.cssText = "position:fixed;left:0;bottom:0;width:800px;height:100px;opacity:0.02;pointer-events:none";
document.body.append(canvas);
const context = canvas.getContext("2d");
let looping = true;
let animationFrames = 0;
const loop = () => {
  animationFrames += 1;
  context.fillStyle = `hsl(${performance.now() % 360},50%,50%)`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (looping) requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
await wait(300);
const countedFrom = performance.now();
const countedAt = animationFrames;
results.whileAnimating = await decodeAll();
results.animationFramesPerSecond = Math.round(((animationFrames - countedAt) * 1000) / (performance.now() - countedFrom));
results.whileAnimatingAgain = await decodeAll();
if (results.softwareSupported) results.softwareWhileAnimating = await decodeAll(softwareConfig);
looping = false;
canvas.remove();
await wait(300);
results.idleAfter = await decodeAll();
results.visibleAtEnd = document.visibilityState;
return results;
