/**
 * Builds fixtures/speech/: synthesized speech between digital silence and pink noise, for testing speech detection
 * with the real Silero model. Not product code. The voice is Windows' built-in text-to-speech, so no real person's
 * voice ends up in the repository, which has a public remote.
 *
 * Where speech lies is measured from the synthesized audio's own level, never from a speech detector.
 *
 * Needs Windows PowerShell with the voice "Microsoft Hedda Desktop" and vendor/ffmpeg.exe.
 * Usage (from the repository root): node bench/make_speech_fixture.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ffmpeg = resolve(repoRoot, "vendor", "ffmpeg.exe");
const windowsPowerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const outDir = resolve(repoRoot, "fixtures", "speech");
const SAMPLE_RATE = 16000;
const VOICE = "Microsoft Hedda Desktop";
// A synthesized sample louder than -40 dBFS counts as voice.
const VOICE_LEVEL = 32768 * 0.01;

const workDir = mkdtempSync(join(tmpdir(), "smarttrim-speech-"));

/** The samples of a 16-bit mono WAV at SAMPLE_RATE. Any other format is refused. */
function wavSamples(wav: Buffer): Int16Array {
  let format: { channels: number; sampleRate: number; bitsPerSample: number } | undefined;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        channels: wav.readUInt16LE(body + 2),
        sampleRate: wav.readUInt32LE(body + 4),
        bitsPerSample: wav.readUInt16LE(body + 14),
      };
    }
    if (id === "data") {
      if (format?.channels !== 1 || format.sampleRate !== SAMPLE_RATE || format.bitsPerSample !== 16) {
        throw new Error(`Unexpected WAV format: ${JSON.stringify(format)}`);
      }
      return new Int16Array(wav.buffer.slice(wav.byteOffset + body, wav.byteOffset + body + size - (size % 2)));
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk.");
}

function synthesize(text: string, index: number): Int16Array {
  const wavPath = join(workDir, `phrase-${index}.wav`);
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$synth.SelectVoice('${VOICE}')`,
    `$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${SAMPLE_RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)`,
    `$synth.SetOutputToWaveFile('${wavPath}', $format)`,
    `$synth.Speak('${text}')`,
    "$synth.Dispose()",
  ].join("; ");
  execFileSync(windowsPowerShell, ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "inherit" });
  return wavSamples(readFileSync(wavPath));
}

function pinkNoise(seconds: number): Int16Array {
  const source = `anoisesrc=color=pink:amplitude=0.1:seed=42:sample_rate=${SAMPLE_RATE}:duration=${seconds}`;
  const raw = execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", source, "-f", "s16le", "-ac", "1", "-"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 2)));
}

const silence = (seconds: number) => new Int16Array(seconds * SAMPLE_RATE);

const pieces = [
  { kind: "silence", samples: silence(2) },
  { kind: "speech", text: "Hallo und willkommen im Stream", samples: synthesize("Hallo und willkommen im Stream", 1) },
  { kind: "noise", samples: pinkNoise(3) },
  { kind: "speech", text: "Jetzt geht es richtig los", samples: synthesize("Jetzt geht es richtig los", 2) },
  { kind: "silence", samples: silence(2) },
] as const;

const layout: { kind: string; text?: string; startSeconds: number; endSeconds: number }[] = [];
const audio = new Int16Array(pieces.reduce((total, piece) => total + piece.samples.length, 0));
let offset = 0;
for (const piece of pieces) {
  audio.set(piece.samples, offset);
  if (piece.kind === "speech") {
    const loud = (sample: number) => Math.abs(sample) > VOICE_LEVEL;
    const first = piece.samples.findIndex(loud);
    const last = piece.samples.findLastIndex(loud);
    if (first < 0) throw new Error(`"${piece.text}" came out silent.`);
    layout.push({
      kind: "speech",
      text: piece.text,
      startSeconds: (offset + first) / SAMPLE_RATE,
      endSeconds: (offset + last + 1) / SAMPLE_RATE,
    });
  } else {
    layout.push({ kind: piece.kind, startSeconds: offset / SAMPLE_RATE, endSeconds: (offset + piece.samples.length) / SAMPLE_RATE });
  }
  offset += piece.samples.length;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "synthetic-speech-16k.pcm"), new Uint8Array(audio.buffer));
writeFileSync(
  join(outDir, "synthetic-speech-16k.json"),
  `${JSON.stringify({ format: "s16le, 16000 Hz, mono", voice: VOICE, durationSeconds: audio.length / SAMPLE_RATE, layout }, null, 2)}\n`,
);
rmSync(workDir, { recursive: true, force: true });
console.log(JSON.stringify(layout, null, 2));
