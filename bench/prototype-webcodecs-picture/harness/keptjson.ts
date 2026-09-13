// Writes the owner's cut of the 25-minute capture (SourceTrack 5, Gaming) as kept stretches, for the WebCodecs picture prototype.
import { writeFileSync } from "node:fs";
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
const out = "C:/Users/user/source/repos/SmartTrim/bench/out/the 25-minute capture-owner-kept.json";
writeFileSync(out, JSON.stringify({ recordingPath, recordingSeconds: cut.summary.recordingSeconds, kept: cut.summary.keptRanges }));
console.log(`wrote ${cut.summary.keptRanges.length} kept stretches to ${out}`);
