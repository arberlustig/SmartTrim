import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// For tests only. The real ffmpeg in vendor/, which is git-ignored and must be present.
const ffmpeg = fileURLToPath(new URL("../../vendor/ffmpeg.exe", import.meta.url));
const speechFixture = fileURLToPath(new URL("../../fixtures/speech/synthetic-speech-16k.pcm", import.meta.url));

/** The frame rate of every Recording `buildVoiceRecording` writes. */
export const VOICE_RECORDING_FRAMES_PER_SECOND = 30;

/**
 * Writes a Recording the way the window gets one: `frames` frames of video at 30 fps with the synthesized voice as its
 * only, stereo SourceTrack at 48 kHz. 362 frames hold the whole voice fixture and its closing silence.
 */
export function buildVoiceRecording(path: string, frames = 362): void {
  execFileSync(ffmpeg, [
    ...["-v", "error", "-y"],
    ...["-f", "lavfi", "-i", `testsrc2=size=320x240:rate=${VOICE_RECORDING_FRAMES_PER_SECOND}`],
    ...["-f", "s16le", "-ar", "16000", "-ac", "1", "-i", speechFixture],
    ...["-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=stereo[voice]"],
    ...["-map", "0:v", "-map", "[voice]", "-frames:v", String(frames)],
    ...["-c:v", "mpeg4", "-c:a", "aac", "-b:a", "128k", path],
  ]);
}
