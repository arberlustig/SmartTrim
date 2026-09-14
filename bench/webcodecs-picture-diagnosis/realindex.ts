import { execFileSync } from "node:child_process";
import { videoIndexOf } from "file:///C:/Users/user/source/repos/SmartTrim/src/video/videoIndex.ts";

const ffprobe = "C:/Users/user/source/repos/SmartTrim/vendor/ffprobe.exe";
const checks: [string, number][] = [
  ["C:/Users/user/Downloads/capture-25min.mp4", 585],
  ["G:/Streams/long-recording.mp4", 1300],
];
for (const [path, from] of checks) {
  const started = performance.now();
  const index = await videoIndexOf(path);
  const ms = performance.now() - started;
  const probe = JSON.parse(
    execFileSync(ffprobe, [
      ...["-v", "error", "-select_streams", "v:0", "-read_intervals", `${from}%${from + 10}`],
      ...["-show_entries", "stream=nb_frames:packet=pts,dts,pos,size,flags", "-of", "json", path],
    ], { maxBuffer: 1 << 28 }).toString(),
  );
  const byPosition = new Map(index.frames.map((frame) => [frame.position, frame]));
  let differ = 0;
  for (const packet of probe.packets) {
    const frame = byPosition.get(Number(packet.pos));
    const same = frame && frame.pts === packet.pts && frame.dts === packet.dts && frame.size === Number(packet.size) && frame.key === packet.flags.startsWith("K");
    if (!same && ++differ <= 3) console.log("differs", packet, frame);
  }
  console.log(`${path}: ${index.frames.length} frames (ffprobe nb_frames ${probe.streams[0].nb_frames}), timescale ${index.timescale}, ${index.decoder.codec}, read in ${ms.toFixed(0)} ms; ${probe.packets.length} packets compared, ${differ} differ`);
}
