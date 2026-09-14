import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { codecOf, readFrameBytes, videoIndexOf } from "./videoIndex";

// These tests run the real binaries in vendor/, which is git-ignored and must be present. ffprobe is the independent
// source of truth: it reads the same sample tables through libavformat, not through SmartTrim's own reader.
const vendor = (name: string) => fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));

/** ffprobe's JSON about the video of a file. */
function ffprobeJson(path: string, ...entries: string[]): string {
  return execFileSync(vendor("ffprobe.exe"), ["-v", "error", "-select_streams", "v:0", ...entries, "-of", "json", path], {
    maxBuffer: 1 << 26,
  }).toString();
}

/** ffprobe's video packets of a file, in file order. JSON, because its CSV output ignores the order fields are named in. */
function ffprobePackets(path: string) {
  const probe = JSON.parse(ffprobeJson(path, "-show_entries", "stream=time_base:packet=pts,dts,pos,size,flags")) as {
    streams: { time_base: string }[];
    packets: { pts: number; dts: number; pos: string; size: string; flags: string }[];
  };
  return {
    timescale: Number(probe.streams[0]?.time_base.split("/")[1]),
    frames: probe.packets.map((packet) => ({
      pts: packet.pts,
      dts: packet.dts,
      position: Number(packet.pos),
      size: Number(packet.size),
      key: packet.flags.startsWith("K"),
    })),
  };
}

/** The bytes of a hex dump as ffprobe's `-show_data` prints it: an offset, groups of hex digits, two spaces, text. */
function bytesOfHexDump(dump: string): Uint8Array {
  const hex = dump
    .split("\n")
    .filter((line) => line.includes(": "))
    .map((line) => line.slice(line.indexOf(": ") + 2).split("  ")[0]?.replaceAll(" ", ""))
    .join("");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/** ffprobe's extradata of the video, which for an MP4 is the decoder configuration record. */
function ffprobeExtradata(path: string): Uint8Array {
  const probe = JSON.parse(ffprobeJson(path, "-show_entries", "stream=extradata", "-show_data")) as {
    streams: { extradata: string }[];
  };
  return bytesOfHexDump(probe.streams[0]?.extradata ?? "");
}

/** ffprobe's own copy of every video packet's bytes, in file order. */
function ffprobePacketBytes(path: string): Uint8Array[] {
  const probe = JSON.parse(ffprobeJson(path, "-show_entries", "packet=data", "-show_data")) as {
    packets: { data: string }[];
  };
  return probe.packets.map((packet) => bytesOfHexDump(packet.data));
}

/**
 * Copies a Recording with one video track and nothing else, its 32-bit chunk offsets (stco) rewritten as the 64-bit
 * ones (co64) a Recording past 4 GB has. ffmpeg writes co64 only when an offset needs it and has no switch to force it.
 * ffmpeg puts the moov after the frames, so growing it moves no frame and the offsets stay true.
 */
function withChunkOffsetsIn64Bits(from: string, to: string): void {
  const file = readFileSync(from);
  const parents: number[] = [];
  let stco = 0;
  let searchFrom = 0;
  for (const type of ["moov", "trak", "mdia", "minf", "stbl", "stco"]) {
    let at = searchFrom;
    while (file.toString("latin1", at + 4, at + 8) !== type) at += file.readUInt32BE(at);
    if (type === "stco") stco = at;
    else parents.push(at);
    searchFrom = at + 8;
  }
  if (file.indexOf("mdat", 0, "latin1") > (parents[0] ?? 0)) throw new Error(`${from} has its moov before its frames.`);

  const count = file.readUInt32BE(stco + 12);
  const co64 = Buffer.alloc(16 + 8 * count);
  co64.writeUInt32BE(co64.length, 0);
  co64.write("co64", 4, "latin1");
  co64.writeUInt32BE(count, 12);
  for (let entry = 0; entry < count; entry++) {
    co64.writeBigUInt64BE(BigInt(file.readUInt32BE(stco + 16 + 4 * entry)), 16 + 8 * entry);
  }
  const copy = Buffer.concat([file.subarray(0, stco), co64, file.subarray(stco + file.readUInt32BE(stco))]);
  for (const at of parents) copy.writeUInt32BE(copy.readUInt32BE(at) + 4 * count, at);
  writeFileSync(to, copy);
}

describe("videoIndexOf", () => {
  let workDir: string;
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-video-index-"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // 75 frames at 30 fps with a keyframe every 30: three keyframes, and no B-frames, so decode and display order agree.
  test("every frame of an H.264 Recording comes out where ffprobe finds it, keyframes marked", async () => {
    const recordingPath = join(workDir, "h264.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-frames:v", "75", "-c:v", "libopenh264", "-g", "30", recordingPath],
    ]);

    const index = await videoIndexOf(recordingPath);

    expect({ timescale: index.timescale, frames: index.frames }).toEqual(ffprobePackets(recordingPath));
  });

  // A hardware VideoDecoder needs the codec named the RFC 6381 way and the avcC record as its description. ffprobe
  // reports the record as extradata; this one reads 01 42 C0 14: profile 0x42 (Constrained Baseline, as ffprobe calls
  // it), constraint flags 0xC0, level 0x14 (ffprobe's level 20).
  test("an H.264 Recording names its codec and hands over its avcC record for the decoder", async () => {
    const recordingPath = join(workDir, "h264-config.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-frames:v", "30", "-c:v", "libopenh264", "-g", "30", recordingPath],
    ]);

    const index = await videoIndexOf(recordingPath);

    expect(index.decoder).toEqual({ codec: "avc1.42C014", description: ffprobeExtradata(recordingPath) });
  });

  // The owner's Recordings are HEVC. kvazaar writes hev1 with B-frames (a keyframe every 32 frames, which must be a
  // multiple of 16), so frames are shown in another order than they are decoded, and an edit list starts the picture
  // half a second into the decode timeline: the first frames decode before zero.
  test("an HEVC Recording with B-frames comes out in ffprobe's order and times, decode times before zero included", async () => {
    const recordingPath = join(workDir, "hevc.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-frames:v", "75", "-c:v", "libkvazaar", "-kvazaar-params", "period=32", recordingPath],
    ]);

    const index = await videoIndexOf(recordingPath);

    expect({ timescale: index.timescale, frames: index.frames }).toEqual(ffprobePackets(recordingPath));
  });

  // OBS writes its composition offsets signed (ctts version 1) and starts the edit list at zero: the owner's captures
  // have offsets down to -1 frame. libavformat then moves every decode time back by the most negative offset, so no
  // frame decodes after it is shown; measured on the 25-minute capture and the long Recording, where only dts lay one frame off before this rule.
  test("negative composition offsets, as OBS writes them, move decode times back as ffprobe does", async () => {
    const recordingPath = join(workDir, "hevc-negative-offsets.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-frames:v", "75", "-c:v", "libkvazaar", "-kvazaar-params", "period=32"],
      ...["-movflags", "negative_cts_offsets", recordingPath],
    ]);

    const index = await videoIndexOf(recordingPath);

    expect({ timescale: index.timescale, frames: index.frames }).toEqual(ffprobePackets(recordingPath));
  });

  // ffprobe calls this record's picture Main profile, level 186. Its first bytes by hand: 01, 01 (Main tier, profile
  // 1), 60 00 00 00 (compatibility, bit-reversed 6), 80 and five zeros (constraints), BA (level 186).
  test("an HEVC Recording names its codec and hands over its hvcC record for the decoder", async () => {
    const recordingPath = join(workDir, "hevc-config.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-frames:v", "32", "-c:v", "libkvazaar", "-kvazaar-params", "period=32", recordingPath],
    ]);

    const index = await videoIndexOf(recordingPath);

    expect(index.decoder).toEqual({ codec: "hev1.1.6.L186.80", description: ffprobeExtradata(recordingPath) });
  });

  // The owner's 2.5-hour captures run past 4 GB, and the long Recording keeps its chunk offsets in co64.
  test("64-bit chunk offsets, as a Recording past 4 GB has them, lead to the frames ffprobe finds", async () => {
    const writtenPath = join(workDir, "h264-stco.mp4");
    const recordingPath = join(workDir, "h264-co64.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-frames:v", "75", "-c:v", "libopenh264", "-g", "30", writtenPath],
    ]);
    withChunkOffsetsIn64Bits(writtenPath, recordingPath);

    const index = await videoIndexOf(recordingPath);

    expect({ timescale: index.timescale, frames: index.frames }).toEqual(ffprobePackets(recordingPath));
  });

  // A fragmented MP4 keeps empty sample tables in its moov and describes its frames piece by piece in moof boxes.
  // Read as it is, it would give a picture with no frames at all and no word why.
  test("a fragmented MP4 is refused instead of read as a picture without frames", async () => {
    const recordingPath = join(workDir, "fragmented.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-frames:v", "75", "-c:v", "libopenh264", "-g", "30", "-movflags", "frag_keyframe+empty_moov", recordingPath],
    ]);

    await expect(videoIndexOf(recordingPath)).rejects.toThrow(
      `${recordingPath} is a fragmented MP4, whose frames SmartTrim cannot look up.`,
    );
  });
});

describe("readFrameBytes", () => {
  let workDir: string;
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-frame-bytes-"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // What reaches the decoder must be each frame's own bytes. ffprobe's packet dump is a copy made without SmartTrim.
  // Frames 28 to 33 run across the keyframe at frame 30.
  test("a stretch of frames comes back as the bytes ffprobe reads for those packets", async () => {
    const recordingPath = join(workDir, "h264.mp4");
    execFileSync(vendor("ffmpeg.exe"), [
      ...["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"],
      ...["-frames:v", "75", "-c:v", "libopenh264", "-g", "30", recordingPath],
    ]);
    const index = await videoIndexOf(recordingPath);

    const bytes = await readFrameBytes(recordingPath, index.frames.slice(28, 34));

    expect(bytes).toEqual(ffprobePacketBytes(recordingPath).slice(28, 34));
  });
});

describe("codecOf", () => {
  // The hvcC record of the owner's 25-minute OBS capture, HEVC 1080p60, which the prototype's hardware decoder took.
  // By hand: byte 1 is 0x01 (profile space 0, Main tier written L, profile 1); bytes 2-5 are 0x60000000, compatible
  // with profiles 1 and 2, written bit-reversed as 6; bytes 6-11 are 0x90 and zeros, trailing zeros left out; byte 12
  // is 0x7B, level 123.
  test("an HEVC codec is named the RFC 6381 way from its hvcC record", () => {
    const record = new Uint8Array(readFileSync(new URL("../../fixtures/video/obs-hevc-1080p60.hvcC", import.meta.url)));

    expect(codecOf("hvc1", record)).toBe("hvc1.1.6.L123.90");
  });
});
