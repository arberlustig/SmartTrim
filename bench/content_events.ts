/**
 * What ContentEvent detection finds on a real Recording, and what it costs:
 *
 *   node bench/content_events.ts "C:/Aufnahmen/stream.mp4" <SourceTrack, 1-based> [riseDb] [baselineSeconds]
 *
 * Prints how many moments it found, how much of the Recording they cover, and the first handful of them, so the
 * numbers behind the defaults in src/level/detectContentEvents.ts can be checked against the material.
 */
import { fileURLToPath } from "node:url";
import { decodeSourceTracks } from "../src/decode/decodeSourceTracks.ts";
import { detectContentEvents } from "../src/level/detectContentEvents.ts";
import { chunkLevelsDbfs } from "../src/level/detectLoudness.ts";
import { probeRecording } from "../src/probe/probeRecording.ts";

const vendor = (name: string) => fileURLToPath(new URL(`../vendor/${name}`, import.meta.url));

const recordingPath = process.argv[2];
const sourceTrackNumber = Number(process.argv[3] ?? 1);
if (!recordingPath) throw new Error("Pass the Recording and the SourceTrack number.");
const riseDb = Number(process.argv[4] ?? 12);
const baselineSeconds = Number(process.argv[5] ?? 5);

const recording = await probeRecording(recordingPath, vendor("ffprobe.exe"));
const [audio] = await decodeSourceTracks(recording, [sourceTrackNumber - 1], vendor("ffmpeg.exe"));
if (!audio) throw new Error(`SourceTrack ${sourceTrackNumber} could not be decoded.`);
const seconds = audio.samples.length / audio.sampleRate;

const levels = chunkLevelsDbfs(audio).filter((level) => level > -190);
const sorted = [...levels].sort((left, right) => left - right);
const at = (share: number) => sorted[Math.floor(sorted.length * share)]?.toFixed(1) ?? "n/a";
console.log(
  `SourceTrack ${sourceTrackNumber} of ${recording.path}: ${(seconds / 60).toFixed(1)} min, ` +
    `levels 10 % ${at(0.1)} dBFS, middle ${at(0.5)} dBFS, 90 % ${at(0.9)} dBFS`,
);

const startedAt = Date.now();
const events = detectContentEvents(audio, { riseDb, baselineSeconds });
const took = (Date.now() - startedAt) / 1000;
const covered = events.reduce((total, event) => total + (event.endSeconds - event.startSeconds), 0);

console.log(
  `rise ${riseDb} dB, baseline ${baselineSeconds} s: ${events.length} events covering ` +
    `${(covered / 60).toFixed(1)} min (${((covered / seconds) * 100).toFixed(1)} % of the SourceTrack), in ${took.toFixed(1)} s`,
);
for (const event of events.slice(0, 8)) {
  const minute = (event.startSeconds / 60) | 0;
  const second = (event.startSeconds % 60).toFixed(1).padStart(4, "0");
  console.log(`  ${minute}:${second} for ${(event.endSeconds - event.startSeconds).toFixed(2)} s`);
}
