// PROTOTYPE, throw away. Reads what WebCodecs needs out of an MP4: the HEVC decoder configuration, and the video
// packets of a stretch (through ffprobe, as JSON: its CSV output ignores the order the fields are asked for).
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, position);
  return buffer;
}

/** The boxes directly inside buffer[start, end): type and where their contents lie. */
function boxesIn(buffer, start, end) {
  const found = [];
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

const inside = (buffer, box, type) => boxesIn(buffer, box.start, box.end).find((child) => child.type === type);

/** `{ codec, description }` for VideoDecoder.configure, from the first HEVC track's hvcC box. */
function hevcConfigOf(path) {
  const fd = fs.openSync(path, "r");
  const fileSize = fs.fstatSync(fd).size;
  let moov = null;
  for (let at = 0; at < fileSize; ) {
    const head = readAt(fd, at, 16);
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    if (size === 1) size = Number(head.readBigUInt64BE(8));
    else if (size === 0) size = fileSize - at;
    if (type === "moov") {
      moov = readAt(fd, at, size);
      break;
    }
    at += size;
  }
  fs.closeSync(fd);
  if (!moov) throw new Error("No moov box.");

  for (const trak of boxesIn(moov, 8, moov.length).filter((box) => box.type === "trak")) {
    const stbl = [["mdia"], ["minf"], ["stbl"]].reduce((box, [type]) => box && inside(moov, box, type), trak);
    const stsd = stbl && inside(moov, stbl, "stsd");
    if (!stsd) continue;
    // stsd: version and flags, entry count, then the sample entries.
    const entry = boxesIn(moov, stsd.start + 8, stsd.end)[0];
    if (!entry || (entry.type !== "hvc1" && entry.type !== "hev1")) continue;
    // A visual sample entry has 78 bytes of its own before its child boxes.
    const hvcC = boxesIn(moov, entry.start + 78, entry.end).find((box) => box.type === "hvcC");
    if (!hvcC) continue;
    const description = new Uint8Array(moov.subarray(hvcC.start, hvcC.end));
    return { codec: codecString(entry.type, description), description };
  }
  throw new Error("No HEVC track with an hvcC box.");
}

/** The RFC 6381 codec string of an HEVC configuration record (ISO/IEC 14496-15, Annex E). */
function codecString(sampleEntry, record) {
  const profileSpace = record[1] >> 6;
  const tier = (record[1] >> 5) & 1;
  const profile = record[1] & 0x1f;
  const compatibility = ((record[2] << 24) | (record[3] << 16) | (record[4] << 8) | record[5]) >>> 0;
  let reversed = 0;
  for (let bit = 0; bit < 32; bit++) if ((compatibility >>> bit) & 1) reversed = (reversed | (1 << (31 - bit))) >>> 0;
  const constraints = [...record.subarray(6, 12)];
  while (constraints.length > 0 && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = record[12];
  const space = ["", "A", "B", "C"][profileSpace];
  return `${sampleEntry}.${space}${profile}.${reversed.toString(16).toUpperCase()}.${tier ? "H" : "L"}${level}${constraints
    .map((byte) => `.${byte.toString(16).toUpperCase()}`)
    .join("")}`;
}

/** Video packets from the keyframe before `fromSeconds` to `toSeconds`, in decode order. */
function packetsBetween(ffprobe, path, fromSeconds, toSeconds) {
  const json = execFileSync(
    ffprobe,
    [
      ...["-v", "error", "-select_streams", "v:0", "-read_intervals", `${fromSeconds}%${toSeconds}`],
      ...["-show_entries", "packet=pts_time,dts_time,duration_time,pos,size,flags", "-of", "json", path],
    ],
    { maxBuffer: 1 << 30 },
  );
  return JSON.parse(json)
    .packets.map((packet) => ({
      pts: Number(packet.pts_time),
      dts: Number(packet.dts_time),
      duration: Number(packet.duration_time),
      pos: Number(packet.pos),
      size: Number(packet.size),
      key: packet.flags.startsWith("K"),
    }))
    .sort((one, other) => one.dts - other.dts);
}

module.exports = { hevcConfigOf, packetsBetween };
