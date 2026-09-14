// Why the playback decoder drains at 60 frames a second while a stretch plays, but at ~1000 when idle. Decodes the same
// real frames (a still frame's feed, fetched over the bridge) without throttling in four situations and reports frames
// per second: idle; sound playing with the picture folded (no SmartTrim decoder running); no sound but a canvas redrawn
// every animation frame; sound playing, plus how often a 4 ms timer fires. Needs the owner's window (globalThis.__row).
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tabId = globalThis.__tabId ?? 1;
const rowNumber = globalThis.__row ?? 1;
const row = () =>
  [...document.querySelectorAll("#sourceTracks .row")].find((each) => each.querySelector("div")?.textContent === `Tonspur ${rowNumber}`);
const playButton = () => row().querySelector("button.play");
const isPlaying = () => playButton().textContent.includes("■");
const pictureFolded = () => document.getElementById("pictureFrame").hidden;
const setFolded = async (folded) => {
  if (pictureFolded() !== folded) document.getElementById("pictureToggle").click();
  await wait(200);
};

const still = await window.smarttrim.stillPicture(tabId, globalThis.__stillSeconds ?? 699);
if (!still.ok) return still.message;
const { decoder: config, feed } = still.value;
const bytes = [];
for (let at = 0; at < feed.length; at += 30) {
  const answer = await window.smarttrim.readFrames(tabId, feed.slice(at, at + 30));
  if (!answer.ok) return answer.message;
  bytes.push(...answer.value);
}
const hardware = {
  codec: config.codec,
  description: config.description,
  codedWidth: 1920,
  codedHeight: 1080,
  optimizeForLatency: true,
  hardwareAcceleration: "prefer-hardware",
};

/** Decodes every frame of the feed as fast as the decoder takes them; frames closed at once. */
async function decodeAll() {
  let out = 0;
  let maxQueue = 0;
  const decoder = new VideoDecoder({ output: (frame) => { out += 1; frame.close(); }, error: () => undefined });
  decoder.configure(hardware);
  const started = performance.now();
  for (let index = 0; index < feed.length; index++) {
    decoder.decode(new EncodedVideoChunk({ type: feed[index].key ? "key" : "delta", timestamp: feed[index].pts, data: bytes[index] }));
    maxQueue = Math.max(maxQueue, decoder.decodeQueueSize);
  }
  await decoder.flush();
  const seconds = (performance.now() - started) / 1000;
  decoder.close();
  return { frames: feed.length, out, ms: Math.round(seconds * 1000), framesPerSecond: Math.round(out / seconds), maxQueue };
}

async function timersPerSecond() {
  let fired = 0;
  const until = performance.now() + 1000;
  while (performance.now() < until) {
    await wait(4);
    fired += 1;
  }
  return fired;
}

const results = { frames: feed.length };
if (isPlaying()) playButton().click();
await setFolded(false);
await wait(500);

results.A_idle = await decodeAll();
results.A_idleTimersPerSecond = await timersPerSecond();

await setFolded(true);
playButton().click();
await wait(1200);
results.B_soundPlayingPictureFolded = await decodeAll();
results.B_timersPerSecond = await timersPerSecond();
results.B_stillPlaying = isPlaying();
playButton().click();
await wait(500);

const canvas = document.createElement("canvas");
canvas.width = 1600;
canvas.height = 200;
canvas.style.cssText = "position:fixed;left:0;bottom:0;width:800px;height:100px;opacity:0.01;pointer-events:none";
document.body.append(canvas);
let animating = true;
const paint = () => {
  const context = canvas.getContext("2d");
  context.fillStyle = `hsl(${performance.now() % 360},50%,50%)`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (animating) requestAnimationFrame(paint);
};
requestAnimationFrame(paint);
await wait(300);
results.C_noSoundCanvasAnimating = await decodeAll();
animating = false;
canvas.remove();
await wait(300);

await setFolded(false);
playButton().click();
await wait(1200);
results.D_soundAndPicturePlaying = await decodeAll();
results.D_timersPerSecond = await timersPerSecond();
if (isPlaying()) playButton().click();
await wait(300);

results.A2_idleAgain = await decodeAll();
return results;
