/**
 * Measures what a SourceTrack scan costs and reports on a real Recording:
 *
 *   node bench/scan_sourcetracks.ts "C:/Aufnahmen/stream.mp4" [slices] [sliceSeconds]
 *
 * Prints a line per SourceTrack, so the verdict the window shows can be checked against the Recording by ear.
 */
import { fileURLToPath } from "node:url";
import { probeRecording } from "../src/probe/probeRecording.ts";
import { scanSourceTracks } from "../src/scan/scanSourceTracks.ts";

const vendor = (name: string) => fileURLToPath(new URL(`../vendor/${name}`, import.meta.url));

const recordingPath = process.argv[2];
if (!recordingPath) throw new Error("Pass the Recording to scan.");
const slices = Number(process.argv[3] ?? 5);
const sliceSeconds = Number(process.argv[4] ?? 10);

const recording = await probeRecording(recordingPath, vendor("ffprobe.exe"));
const seconds = (recording.durationFrames * recording.frameRate.denominator) / recording.frameRate.numerator;
console.log(
  `${recording.path}: ${(seconds / 60).toFixed(1)} min, ${recording.sourceTracks.length} SourceTracks, ` +
    `scanning ${slices} slices of ${sliceSeconds} s`,
);

const startedAt = Date.now();
const scan = await scanSourceTracks(recording, vendor("ffmpeg.exe"), { slices, sliceSeconds });
const took = (Date.now() - startedAt) / 1000;

scan.forEach((sourceTrack, position) => {
  const peak = sourceTrack.peakDbfs === -Infinity ? "silent" : `${sourceTrack.peakDbfs.toFixed(1)} dBFS peak`;
  console.log(
    `  SourceTrack ${position + 1}: ${sourceTrack.carriesSound ? "carries sound" : "EMPTY"} ` +
      `(${sourceTrack.slicesWithSound}/${sourceTrack.sliceCount} slices, ${peak})`,
  );
});
console.log(`scan took ${took.toFixed(1)} s`);
