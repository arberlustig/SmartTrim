// Which kind of drawing on every animation frame holds the hardware decoder to ~60 frames a second. Same real frames,
// decoded without throttling, nothing playing, one kind of per-frame drawing at a time.
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
async function decodeAll() {
  let out = 0;
  const decoder = new VideoDecoder({ output: (frame) => { out += 1; frame.close(); }, error: () => undefined });
  decoder.configure(decoderConfig);
  const started = performance.now();
  for (let index = 0; index < feed.length; index++) {
    decoder.decode(new EncodedVideoChunk({ type: feed[index].key ? "key" : "delta", timestamp: feed[index].pts, data: bytes[index] }));
  }
  await decoder.flush();
  const seconds = (performance.now() - started) / 1000;
  decoder.close();
  return Math.round(out / seconds);
}

const place = (element, width, height) => {
  element.style.cssText = `position:fixed;left:0;bottom:0;width:${width}px;height:${height}px;opacity:0.02;pointer-events:none`;
  document.body.append(element);
  return element;
};

/** Decodes while `drawEachFrame` runs on every animation frame; `setup` makes what it draws, `teardown` removes it. */
async function whileDrawing(setup, drawEachFrame, teardown) {
  const thing = setup();
  let looping = true;
  const loop = () => {
    drawEachFrame(thing);
    if (looping) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await wait(300);
  const framesPerSecond = await decodeAll();
  looping = false;
  await wait(100);
  teardown(thing);
  await wait(300);
  return framesPerSecond;
}

const fill = (context, canvas) => {
  context.fillStyle = `hsl(${performance.now() % 360},50%,50%)`;
  context.fillRect(0, 0, canvas.width, canvas.height);
};
const canvasOf = (width, height, options) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  place(canvas, Math.min(width, 800), Math.min(height, 200));
  return { canvas, context: canvas.getContext("2d", options) };
};

const results = { frames: feed.length, idle: await decodeAll() };

results.C_2dCanvas1600x200 = await whileDrawing(
  () => canvasOf(1600, 200),
  ({ canvas, context }) => fill(context, canvas),
  ({ canvas }) => canvas.remove(),
);

results.C2_cssMovedElementNoCanvas = await whileDrawing(
  () => {
    const element = place(document.createElement("div"), 4, 100);
    element.style.background = "white";
    element.style.willChange = "transform";
    return element;
  },
  (element) => {
    element.style.transform = `translateX(${Math.round(performance.now() / 5) % 800}px)`;
  },
  (element) => element.remove(),
);

results.C3_2dCanvas32x32 = await whileDrawing(
  () => canvasOf(32, 32),
  ({ canvas, context }) => fill(context, canvas),
  ({ canvas }) => canvas.remove(),
);

results.K_2dCanvas1600x200_offTheGpu = await whileDrawing(
  () => canvasOf(1600, 200, { willReadFrequently: true }),
  ({ canvas, context }) => fill(context, canvas),
  ({ canvas }) => canvas.remove(),
);

results.W_webglCanvas1600x200 = await whileDrawing(
  () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 200;
    place(canvas, 800, 100);
    return { canvas, gl: canvas.getContext("webgl") };
  },
  ({ gl }) => {
    const hue = (performance.now() % 1000) / 1000;
    gl.clearColor(hue, 0.5, 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },
  ({ canvas }) => canvas.remove(),
);

const image = await createImageBitmap(canvasOf(960, 540).canvas);
results.D1_drawImage960x540EachFrame = await whileDrawing(
  () => canvasOf(960, 540),
  ({ context }) => context.drawImage(image, 0, 0),
  ({ canvas }) => canvas.remove(),
);
image.close();
for (const leftover of document.querySelectorAll("body > canvas")) leftover.remove();

results.idleAfter = await decodeAll();
return results;
