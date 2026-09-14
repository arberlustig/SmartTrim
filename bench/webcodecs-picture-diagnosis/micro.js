// Tight loop for the window freezes: WebCodecs steps on their own, no SmartTrim picture code, measuring how late
// animation frames come meanwhile. Needs the 25-minute capture open in Tab 1 (globalThis.__tabId) of the dev window.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tabId = globalThis.__tabId ?? 1;
const still = await window.smarttrim.stillPicture(tabId, globalThis.__stillSeconds ?? 585.9);
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
const chunkOf = (index) =>
  new EncodedVideoChunk({ type: feed[index].key ? "key" : "delta", timestamp: feed[index].pts, data: bytes[index] });

let last = performance.now();
const late = [];
let running = true;
const tick = (at) => {
  if (at - last > 50) late.push({ at, ms: Math.round(at - last) });
  last = at;
  if (running) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
await wait(500);

async function phase(name, times, body) {
  const from = performance.now();
  const steps = [];
  for (let run = 0; run < times; run++) {
    const started = performance.now();
    const detail = await body();
    steps.push({ ms: Math.round(performance.now() - started), ...detail });
    await wait(800);
  }
  const mine = late.filter((entry) => entry.at >= from && entry.at <= performance.now());
  return {
    name,
    freezesOver100ms: mine.filter((entry) => entry.ms > 100).length,
    longestFreezeMs: Math.max(0, ...mine.map((entry) => entry.ms)),
    freezes: mine.map((entry) => entry.ms).join(" "),
    steps: steps.map((step) => JSON.stringify(step)).join(" "),
  };
}

async function decodeAll({ throttle, bitmaps }) {
  let out = 0;
  const pending = [];
  const decoder = new VideoDecoder({
    output: (frame) => {
      out += 1;
      if (bitmaps) {
        pending.push(
          createImageBitmap(frame, { resizeWidth: 960, resizeHeight: 540, resizeQuality: "medium" }).then((image) => {
            image.close();
            frame.close();
          }),
        );
      } else {
        frame.close();
      }
    },
    error: () => undefined,
  });
  decoder.configure(hardware);
  const started = performance.now();
  for (let index = 0; index < feed.length; index++) {
    while (throttle && decoder.decodeQueueSize > 8) await wait(1);
    decoder.decode(chunkOf(index));
  }
  await decoder.flush();
  await Promise.all(pending);
  const decodeMs = Math.round(performance.now() - started);
  const closing = performance.now();
  decoder.close();
  return { frames: feed.length, out, decodeMs, closeMs: Math.round(performance.now() - closing) };
}

const results = [];
results.push(await phase("idle", 3, async () => ({})));
results.push(
  await phase("isConfigSupported", 5, async () => ({ supported: (await VideoDecoder.isConfigSupported(hardware)).supported })),
);
results.push(
  await phase("configure, wait, close", 5, async () => {
    const decoder = new VideoDecoder({ output: (frame) => frame.close(), error: () => undefined });
    decoder.configure(hardware);
    await wait(300);
    const closing = performance.now();
    decoder.close();
    return { closeMs: Math.round(performance.now() - closing) };
  }),
);
results.push(await phase("decode feed, no throttle", 5, () => decodeAll({ throttle: false, bitmaps: false })));
results.push(await phase("decode feed, throttled to 8", 5, () => decodeAll({ throttle: true, bitmaps: false })));
results.push(await phase("decode feed, throttled, 960px copy of each", 3, () => decodeAll({ throttle: true, bitmaps: true })));
running = false;
return results;
