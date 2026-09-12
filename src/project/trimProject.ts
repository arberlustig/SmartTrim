import type { Decision } from "../analysis/analyseRecording.ts";
import type { TimeRange } from "../cutting/planCuts.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import type { SourceTrackScan } from "../scan/scanSourceTracks.ts";

/**
 * The format number of the file, raised whenever a field is added that an older SmartTrim would drop. A file from a
 * newer version is refused rather than half read: saving it again would throw away what this version cannot see.
 */
const FORMAT = 1;

/**
 * A saved session: the Recording as it was probed, what the user chose, and — the point of the whole file — the
 * stretches the analysis found worth keeping. With those, reopening can plan the cuts again without reading the
 * Recording (ADR-0004). The decoded audio is not saved: it is hundreds of megabytes, and only a new threshold
 * would need it.
 */
export interface TrimProject {
  recording: RecordingInfo;
  /** The SourceTracks that were listened to, by position in the Recording. */
  listenTo: readonly number[];
  /** The SourceTracks that go into the Premiere sequence (ADR-0014). */
  exportSourceTracks: readonly number[];
  /** What a scan found on the SourceTracks, when one had run (ADR-0013). */
  scan?: readonly SourceTrackScan[];
  decideBy: Decision;
  marginSeconds: number;
  /** ADR-0007: measured after the Margin is kept. */
  minimumDeadZoneSeconds: number;
  worthKeeping: readonly TimeRange[];
}

/** Writes a session as the text of a `.smarttrim` file. */
export function trimProjectText(project: TrimProject): string {
  // The version comes first so the file says what it is in its first line, and one space of indent keeps a file
  // with thousands of ranges readable without doubling its size.
  return JSON.stringify({ smarttrim: FORMAT, savedAt: new Date().toISOString(), ...project }, undefined, 1);
}

/** Reads a field that has to be there, refusing a file that is missing it rather than carrying on with a default. */
function need<Value>(from: Record<string, unknown>, field: string, looksRight: (value: unknown) => boolean): Value {
  const value = from[field];
  if (!looksRight(value)) throw new Error(`This SmartTrim project is missing its ${field}.`);
  return value as Value;
}

const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const isNumberArray = (value: unknown) => Array.isArray(value) && value.every(isNumber);
const isObject = (value: unknown) => typeof value === "object" && value !== null;
const isRangeArray = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (range) =>
      isObject(range) && isNumber((range as TimeRange).startSeconds) && isNumber((range as TimeRange).endSeconds),
  );

/** Reads the text of a `.smarttrim` file. Anything that is not one, or is newer than this SmartTrim, is refused. */
export function readTrimProject(text: string): TrimProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not a SmartTrim project.");
  }
  if (!isObject(parsed)) throw new Error("This file is not a SmartTrim project.");
  const file = parsed as Record<string, unknown>;
  const format = file["smarttrim"];
  if (!isNumber(format)) throw new Error("This file is not a SmartTrim project.");
  if ((format as number) > FORMAT) {
    throw new Error(
      `This project was saved by a newer version of SmartTrim (format ${format as number}, this one reads ${FORMAT}).`,
    );
  }

  const project: TrimProject = {
    recording: need(file, "recording", (value) => isObject(value) && Array.isArray((value as RecordingInfo).sourceTracks)),
    listenTo: need(file, "listenTo", isNumberArray),
    exportSourceTracks: need(file, "exportSourceTracks", isNumberArray),
    decideBy: need(file, "decideBy", (value) => isObject(value) && typeof (value as Decision).kind === "string"),
    marginSeconds: need(file, "marginSeconds", isNumber),
    minimumDeadZoneSeconds: need(file, "minimumDeadZoneSeconds", isNumber),
    worthKeeping: need(file, "worthKeeping", isRangeArray),
  };
  const scan = file["scan"];
  if (!Array.isArray(scan)) return project;
  // JSON has no -Infinity: a silent SourceTrack's peak goes out as null and has to come back as silence, or a
  // reopened project would read "peak 0 dBFS" off a track that holds nothing.
  const restored = scan.map((sourceTrack) => {
    const entry = sourceTrack as SourceTrackScan;
    return { ...entry, peakDbfs: isNumber(entry.peakDbfs) ? entry.peakDbfs : -Infinity };
  });
  return { ...project, scan: restored };
}
