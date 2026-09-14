// PROTOTYPE, throwaway. Writes 192 real frames of a Recording's video, from the keyframe at or before a moment, so the
// brake check can decode them without SmartTrim's IPC. The output holds the owner's picture: keep it in the scratchpad.
//   node bench/prototype-jpeg-picture/checks/extract-frames.ts "<Recording>" <seconds> <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFrameBytes, videoIndexOf } from "../../../src/video/videoIndex.ts";

const [path, secondsText, outDir] = process.argv.slice(2);
const index = await videoIndexOf(path);
let start = 0;
for (let at = 0; at < index.frames.length; at++) {
  const frame = index.frames[at];
  if (frame.key && frame.pts <= Number(secondsText) * index.timescale) start = at;
}
const frames = index.frames.slice(start, start + 192);
const bytes = await readFrameBytes(path, frames);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "frames.bin"), Buffer.concat(bytes));
writeFileSync(
  join(outDir, "frames.json"),
  JSON.stringify({
    codec: index.decoder.codec,
    description: Buffer.from(index.decoder.description).toString("base64"),
    frames: frames.map((frame) => ({ pts: frame.pts, key: frame.key, size: frame.size })),
  }),
);
console.log({ codec: index.decoder.codec, frames: frames.length, firstKey: frames[0].key, megabytes: bytes.reduce((sum, b) => sum + b.length, 0) / 1e6 });
