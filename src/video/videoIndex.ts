import { open, type FileHandle } from "node:fs/promises";

/** One frame of a Recording's video as the MP4's sample tables describe it. */
export interface IndexedFrame {
  /** When the frame is shown, in ticks of the video's timescale. */
  pts: number;
  /** When the frame is decoded, in ticks of the video's timescale. */
  dts: number;
  /** Where its bytes start in the file. */
  position: number;
  size: number;
  /** Whether decoding can start at this frame. */
  key: boolean;
}

/** What `VideoDecoder.configure` needs to decode the frames. */
export interface DecoderConfig {
  /** The codec named the RFC 6381 way, such as `avc1.42C014`. */
  codec: string;
  /** The decoder configuration record, as the MP4 holds it. */
  description: Uint8Array;
}

/** Everything the window needs to decode a Recording's picture without reading the whole file (ADR-0027). */
export interface VideoIndex {
  /** Ticks per second of `pts` and `dts`. */
  timescale: number;
  /** In decode order, which is file order. */
  frames: IndexedFrame[];
  decoder: DecoderConfig;
}

/** A box found in a buffer: its type and where its contents lie. */
interface Box {
  type: string;
  start: number;
  end: number;
}

/** The boxes directly inside `buffer[start, end)`. */
function boxesIn(buffer: Buffer, start: number, end: number): Box[] {
  const found: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buffer.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    found.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return found;
}

function childOf(buffer: Buffer, box: Box | undefined, type: string): Box | undefined {
  return box && boxesIn(buffer, box.start, box.end).find((inner) => inner.type === type);
}

/** The `moov` box of the file, read whole: it holds the sample tables, a few megabytes even for hours of video. */
async function readMoov(file: FileHandle, path: string): Promise<Buffer> {
  const { size: fileSize } = await file.stat();
  const head = Buffer.alloc(16);
  for (let at = 0; at + 8 <= fileSize; ) {
    await file.read(head, 0, 16, at);
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    if (size === 1) size = Number(head.readBigUInt64BE(8));
    else if (size === 0) size = fileSize - at;
    if (type === "moov") {
      const moov = Buffer.alloc(size);
      await file.read(moov, 0, size, at);
      return moov;
    }
    at += size;
  }
  throw new Error(`${path} has no moov box.`);
}

/**
 * The entries of a sample table, a full box whose entry count sits `skip` bytes after its version and flags: an entry
 * is `fields` 32-bit numbers, and `read(entry, field)` gives one of them.
 */
function tableOf(buffer: Buffer, box: Box, fields: number, skip = 0) {
  const first = box.start + 8 + skip;
  return {
    count: buffer.readUInt32BE(box.start + 4 + skip),
    read: (entry: number, field = 0) => buffer.readUInt32BE(first + (entry * fields + field) * 4),
  };
}

const upperHex = (value: number) => value.toString(16).toUpperCase();

/**
 * The codec of a sample entry (`avc1`, `hvc1`, ...) named the RFC 6381 way from its decoder configuration record, as
 * `VideoDecoder.configure` wants it.
 */
export function codecOf(sampleEntry: string, record: Uint8Array): string {
  if (sampleEntry === "avc1" || sampleEntry === "avc3") {
    // Profile, constraint flags and level: the three bytes after the record's version, two hex digits each.
    return `${sampleEntry}.${[...record.subarray(1, 4)].map((byte) => upperHex(byte).padStart(2, "0")).join("")}`;
  }
  // HEVC (ISO/IEC 14496-15, Annex E): profile space as a letter, profile, the 32 compatibility flags bit-reversed,
  // tier and level, then the six constraint bytes without trailing zeros.
  const first = record[1] ?? 0;
  const level = record[12] ?? 0;
  const compatibility = ((record[2] ?? 0) << 24) | ((record[3] ?? 0) << 16) | ((record[4] ?? 0) << 8) | (record[5] ?? 0);
  let reversed = 0;
  for (let bit = 0; bit < 32; bit++) reversed = (reversed << 1) | ((compatibility >>> bit) & 1);
  const constraints = [...record.subarray(6, 12)];
  while (constraints.at(-1) === 0) constraints.pop();
  const space = ["", "A", "B", "C"][first >> 6] ?? "";
  const tier = (first >> 5) & 1 ? "H" : "L";
  return [
    sampleEntry,
    `${space}${first & 0x1f}`,
    upperHex(reversed >>> 0),
    `${tier}${level}`,
    ...constraints.map(upperHex),
  ].join(".");
}

/** The decoder configuration of the first sample description in `stsd`: H.264 or HEVC, nothing else. */
function decoderConfigOf(buffer: Buffer, stsd: Box, path: string): DecoderConfig {
  // stsd: version and flags, entry count, then the sample entries.
  const entry = boxesIn(buffer, stsd.start + 8, stsd.end)[0];
  // A visual sample entry has 78 bytes of its own before its child boxes.
  const record =
    entry && boxesIn(buffer, entry.start + 78, entry.end).find((box) => box.type === "avcC" || box.type === "hvcC");
  if (!entry || !record) throw new Error(`${path}: the picture is neither H.264 nor HEVC.`);
  const description = new Uint8Array(buffer.subarray(record.start, record.end));
  return { codec: codecOf(entry.type, description), description };
}

/**
 * The bytes of `frames`, one array each, read from the Recording in one go. Each is a copy of its own: a view into the
 * shared read would carry the whole stretch through IPC with every frame.
 */
export async function readFrameBytes(path: string, frames: readonly IndexedFrame[]): Promise<Uint8Array[]> {
  const from = Math.min(...frames.map((frame) => frame.position));
  const to = Math.max(...frames.map((frame) => frame.position + frame.size));
  const stretch = Buffer.alloc(to - from);
  const file = await open(path, "r");
  try {
    await file.read(stretch, 0, stretch.length, from);
  } finally {
    await file.close();
  }
  return frames.map((frame) => new Uint8Array(stretch.subarray(frame.position - from, frame.position - from + frame.size)));
}

/** Reads the video frames of an MP4 Recording from its own sample tables. */
export async function videoIndexOf(path: string): Promise<VideoIndex> {
  const file = await open(path, "r");
  let moov: Buffer;
  try {
    moov = await readMoov(file, path);
  } finally {
    await file.close();
  }

  // A fragmented MP4 announces its moof pieces with mvex and leaves the sample tables in moov empty.
  const topBoxes = boxesIn(moov, 8, moov.length);
  if (topBoxes.some((box) => box.type === "mvex")) {
    throw new Error(`${path} is a fragmented MP4, whose frames SmartTrim cannot look up.`);
  }

  const trak = topBoxes
    .filter((box) => box.type === "trak")
    .find((box) => {
      const hdlr = childOf(moov, childOf(moov, box, "mdia"), "hdlr");
      return hdlr !== undefined && moov.toString("latin1", hdlr.start + 8, hdlr.start + 12) === "vide";
    });
  const video = childOf(moov, trak, "mdia");
  const mdhd = childOf(moov, video, "mdhd");
  const stbl = childOf(moov, childOf(moov, video, "minf"), "stbl");
  const stsd = childOf(moov, stbl, "stsd");
  const stsz = childOf(moov, stbl, "stsz");
  const stts = childOf(moov, stbl, "stts");
  const stsc = childOf(moov, stbl, "stsc");
  // 32-bit chunk offsets, or 64-bit ones in a Recording past 4 GB.
  const chunkOffsetBox = childOf(moov, stbl, "stco") ?? childOf(moov, stbl, "co64");
  if (!mdhd || !stsd || !stsz || !stts || !stsc || !chunkOffsetBox) {
    throw new Error(`${path} has no video track with sample tables.`);
  }

  const timescale = moov.readUInt32BE(mdhd.start + (moov[mdhd.start] === 1 ? 20 : 12));

  const sampleSize = moov.readUInt32BE(stsz.start + 4);
  const sizeTable = tableOf(moov, stsz, 1, 4);
  const sizes = Array.from({ length: sizeTable.count }, (_, frame) => sampleSize || sizeTable.read(frame));

  const dtss: number[] = [];
  const timeToSample = tableOf(moov, stts, 2);
  for (let entry = 0, dts = 0; entry < timeToSample.count; entry++) {
    const delta = timeToSample.read(entry, 1);
    for (let sample = timeToSample.read(entry, 0); sample > 0; sample--, dts += delta) dtss.push(dts);
  }

  const positions: number[] = [];
  const chunkCount = moov.readUInt32BE(chunkOffsetBox.start + 4);
  const chunkOffsetOf =
    chunkOffsetBox.type === "co64"
      ? (chunk: number) => Number(moov.readBigUInt64BE(chunkOffsetBox.start + 8 + 8 * chunk))
      : (chunk: number) => moov.readUInt32BE(chunkOffsetBox.start + 8 + 4 * chunk);
  const samplesToChunk = tableOf(moov, stsc, 3);
  for (let chunk = 0, run = 0; chunk < chunkCount; chunk++) {
    // Runs name their first chunk counting from 1; a run lasts until the next one's first chunk.
    while (run + 1 < samplesToChunk.count && samplesToChunk.read(run + 1, 0) - 1 <= chunk) run++;
    let position = chunkOffsetOf(chunk);
    for (let sample = samplesToChunk.read(run, 1); sample > 0; sample--) {
      const size = sizes[positions.length] ?? 0;
      positions.push(position);
      position += size;
    }
  }

  const stss = childOf(moov, stbl, "stss");
  const syncTable = stss && tableOf(moov, stss, 1);
  const keys = syncTable && new Set(Array.from({ length: syncTable.count }, (_, entry) => syncTable.read(entry) - 1));

  // With B-frames a frame is shown at another time than it is decoded, by an offset per frame.
  const offsets: number[] = [];
  let mostNegativeOffset = 0;
  const ctts = childOf(moov, stbl, "ctts");
  const compositionOffsets = ctts && tableOf(moov, ctts, 2);
  for (let entry = 0; compositionOffsets && entry < compositionOffsets.count; entry++) {
    // Version 1 offsets are signed; a version 0 offset never reaches 2^31, so both read the same as signed.
    const offset = compositionOffsets.read(entry, 1) | 0;
    mostNegativeOffset = Math.min(mostNegativeOffset, offset);
    for (let sample = compositionOffsets.read(entry, 0); sample > 0; sample--) offsets.push(offset);
  }

  // The edit list names where on that timeline the picture starts. libavformat counts every time from there, which
  // puts the first decode times before zero.
  const elst = childOf(moov, childOf(moov, trak, "edts"), "elst");
  const editStart =
    !elst || moov.readUInt32BE(elst.start + 4) === 0
      ? 0
      : moov[elst.start] === 1
        ? Number(moov.readBigInt64BE(elst.start + 16))
        : moov.readInt32BE(elst.start + 12);

  return {
    timescale,
    frames: sizes.map((size, frame) => ({
      pts: (dtss[frame] ?? 0) + (offsets[frame] ?? 0) - editStart,
      // A negative offset would show a frame before it is decoded; libavformat moves every decode time back by the
      // most negative one instead. OBS writes offsets down to -1 frame (ADR-0027).
      dts: (dtss[frame] ?? 0) - editStart + mostNegativeOffset,
      position: positions[frame] ?? 0,
      size,
      key: keys === undefined || keys.has(frame),
    })),
    decoder: decoderConfigOf(moov, stsd, path),
  };
}
