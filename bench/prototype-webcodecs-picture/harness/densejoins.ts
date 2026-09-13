// Finds where in the 25-minute capture the owner's cut (SourceTrack 5, Gaming) puts the most Joins into 8 s of what is played.
import { runCut } from "file:///C:/Users/user/source/repos/SmartTrim/src/app/runCut.ts";

const vendor = "C:/Users/user/source/repos/SmartTrim/vendor";
const tools = { ffprobe: `${vendor}/ffprobe.exe`, ffmpeg: `${vendor}/ffmpeg.exe`, sileroModel: `${vendor}/silero_vad.onnx` };
const recordingPath = "C:/Users/user/Downloads/capture-25min.mp4";

const cut = await runCut(
  {
    recordingPath,
    voiceSourceTracks: [4],
    contentSourceTracks: [],
    decideBy: { kind: "loudness", thresholdDbfs: -40 },
    marginSeconds: 0.05,
    eventLeadSeconds: 1.5,
    eventTailSeconds: 2,
    minimumDeadZoneSeconds: 0.25,
  },
  tools,
);
const kept = cut.summary.keptRanges;
const lengths = kept.map((range) => range.endSeconds - range.startSeconds).sort((a, b) => a - b);
console.log(`recording ${cut.summary.recordingSeconds} s, ${kept.length} kept stretches, median kept ${lengths[Math.floor(lengths.length / 2)]?.toFixed(2)} s`);

// For each kept stretch as a start: how many Joins fall into the next 8 s of played sound.
const windows = kept.map((range, at) => {
  let played = 0;
  let joins = 0;
  for (let next = at; next < kept.length && played < 8; next++) {
    const piece = kept[next] as { startSeconds: number; endSeconds: number };
    if (next > at) joins += 1;
    played += piece.endSeconds - piece.startSeconds;
  }
  return { startSeconds: range.startSeconds, joins, fraction: range.startSeconds / cut.summary.recordingSeconds };
});
windows.sort((a, b) => b.joins - a.joins);
console.log("densest 8 s windows:", JSON.stringify(windows.slice(0, 5)));
const all = windows.map((w) => w.joins).sort((a, b) => a - b);
console.log(`joins per 8 s: median ${all[Math.floor(all.length / 2)]}, 90th percentile ${all[Math.floor(all.length * 0.9)]}`);
