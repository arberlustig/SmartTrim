import { readFileSync } from "node:fs";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { describe, expect, test } from "vitest";
import type { CutPlan } from "../cutting/planCuts";
import { exportFcp7Xml, type RecordingInfo } from "./exportFcp7Xml";

// Inputs are transcribed from fixtures/premiere/single-audio-30fps.xml.
// Expectations are never transcribed: every test reads them from the fixture itself.
const singleRecording: RecordingInfo = {
  path: "C:\\media\\Single Track Test 🥶.mp4",
  frameRate: { numerator: 30, denominator: 1 },
  width: 1280,
  height: 720,
  durationFrames: 4873,
  sourceTracks: [{ channelCount: 2, sampleRate: 44100, bitDepth: 16, durationFrames: 4873 }],
};

const singleCutPlan: CutPlan = [
  { recordingIn: 0, recordingOut: 150, timelineStart: 0, timelineEnd: 150 },
  { recordingIn: 378, recordingOut: 638, timelineStart: 150, timelineEnd: 410 },
  { recordingIn: 814, recordingOut: 1013, timelineStart: 410, timelineEnd: 609 },
  { recordingIn: 1146, recordingOut: 1366, timelineStart: 609, timelineEnd: 829 },
  { recordingIn: 1516, recordingOut: 1603, timelineStart: 829, timelineEnd: 916 },
  { recordingIn: 1603, recordingOut: 1828, timelineStart: 916, timelineEnd: 1141 },
  { recordingIn: 1828, recordingOut: 4873, timelineStart: 1141, timelineEnd: 4186 },
];

const singleFixture = parseXml(
  readFileSync(new URL("../../fixtures/premiere/single-audio-30fps.xml", import.meta.url), "utf8"),
);

// Inputs transcribed from fixtures/premiere/multitrack-6audio-60fps.xml. SourceTrack 1 runs as long as the
// video; SourceTracks 2–6 end two frames earlier, and Premiere ends their clips there.
const multitrackSourceTrack = { channelCount: 2, sampleRate: 48000, bitDepth: 16 };
const multitrackRecording: RecordingInfo = {
  path: "C:\\media\\long-recording.mp4",
  frameRate: { numerator: 60, denominator: 1 },
  width: 1920,
  height: 1080,
  durationFrames: 546692,
  sourceTracks: [
    { ...multitrackSourceTrack, durationFrames: 546692 },
    { ...multitrackSourceTrack, durationFrames: 546690 },
    { ...multitrackSourceTrack, durationFrames: 546690 },
    { ...multitrackSourceTrack, durationFrames: 546690 },
    { ...multitrackSourceTrack, durationFrames: 546690 },
    { ...multitrackSourceTrack, durationFrames: 546690 },
  ],
};

const multitrackCutPlan: CutPlan = [
  { recordingIn: 0, recordingOut: 61896, timelineStart: 0, timelineEnd: 61896 },
  { recordingIn: 61896, recordingOut: 546692, timelineStart: 61896, timelineEnd: 546692 },
];

const multitrackFixture = parseXml(
  readFileSync(new URL("../../fixtures/premiere/multitrack-6audio-60fps.xml", import.meta.url), "utf8"),
);

function parseXml(xml: string): Element {
  // xmldom silently accepts a bare "&" in text, which the XML spec and strict readers reject.
  const bareAmpersand = /&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[0-9a-fA-F]+;)/.exec(xml);
  if (bareAmpersand) throw new Error(`XML error: unescaped "&" at offset ${bareAmpersand.index}`);

  // Malformed XML must fail the test instead of being quietly repaired by the parser.
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw new Error(`XML ${level}: ${message}`);
    },
  });
  const root = parser.parseFromString(xml, "text/xml").documentElement;
  if (!root) throw new Error("XML has no root element");
  return root;
}

const ELEMENT_NODE = 1;

function children(parent: Element, name: string): Element[] {
  const found: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes.item(i);
    if (node?.nodeType === ELEMENT_NODE && node.nodeName === name) found.push(node as Element);
  }
  return found;
}

/** Follows direct children along a slash-separated path. A missing step throws, so two absent values never compare equal. */
function child(parent: Element, path: string): Element {
  let current = parent;
  for (const name of path.split("/")) {
    const next = children(current, name)[0];
    if (!next) throw new Error(`<${current.nodeName}> has no <${name}> (path ${path})`);
    current = next;
  }
  return current;
}

const text = (parent: Element, path: string) => child(parent, path).textContent;

function sequenceSummary(root: Element) {
  const sequence = child(root, "sequence");
  return {
    xmemlVersion: root.getAttribute("version"),
    explodedTracks: sequence.getAttribute("explodedTracks"),
    name: text(sequence, "name"),
    duration: text(sequence, "duration"),
    timebase: text(sequence, "rate/timebase"),
    ntsc: text(sequence, "rate/ntsc"),
  };
}

/** TimelineTracks that hold clips; the empty tracks a Premiere sequence preset adds carry no meaning. */
function tracksWithClips(root: Element, mediaType: "video" | "audio"): Element[] {
  return children(child(root, `sequence/media/${mediaType}`), "track").filter(
    (track) => children(track, "clipitem").length > 0,
  );
}

function videoTracks(root: Element) {
  return tracksWithClips(root, "video").map((track) => ({
    enabled: text(track, "enabled"),
    locked: text(track, "locked"),
    clips: children(track, "clipitem").map((clip) => ({
      masterclipid: text(clip, "masterclipid"),
      name: text(clip, "name"),
      enabled: text(clip, "enabled"),
      duration: text(clip, "duration"),
      timebase: text(clip, "rate/timebase"),
      ntsc: text(clip, "rate/ntsc"),
      start: text(clip, "start"),
      end: text(clip, "end"),
      in: text(clip, "in"),
      out: text(clip, "out"),
    })),
  }));
}

function fileDefinition(file: Element) {
  return {
    id: file.getAttribute("id"),
    name: text(file, "name"),
    pathurl: text(file, "pathurl"),
    timebase: text(file, "rate/timebase"),
    ntsc: text(file, "rate/ntsc"),
    duration: text(file, "duration"),
    timecode: {
      timebase: text(file, "timecode/rate/timebase"),
      ntsc: text(file, "timecode/rate/ntsc"),
      string: text(file, "timecode/string"),
      frame: text(file, "timecode/frame"),
      displayformat: text(file, "timecode/displayformat"),
    },
    video: {
      timebase: text(file, "media/video/samplecharacteristics/rate/timebase"),
      ntsc: text(file, "media/video/samplecharacteristics/rate/ntsc"),
      width: text(file, "media/video/samplecharacteristics/width"),
      height: text(file, "media/video/samplecharacteristics/height"),
      anamorphic: text(file, "media/video/samplecharacteristics/anamorphic"),
      pixelaspectratio: text(file, "media/video/samplecharacteristics/pixelaspectratio"),
      fielddominance: text(file, "media/video/samplecharacteristics/fielddominance"),
    },
    audio: children(child(file, "media"), "audio").map((audio) => ({
      depth: text(audio, "samplecharacteristics/depth"),
      samplerate: text(audio, "samplecharacteristics/samplerate"),
      channelcount: text(audio, "channelcount"),
    })),
  };
}

function videoFileReferences(root: Element) {
  return tracksWithClips(root, "video").flatMap((track) =>
    children(track, "clipitem").map((clip) => {
      const file = child(clip, "file");
      return children(file, "name").length > 0 ? fileDefinition(file) : { refersTo: file.getAttribute("id") };
    }),
  );
}

function audioTracks(root: Element) {
  return tracksWithClips(root, "audio").map((track) => ({
    premiereTrackType: track.getAttribute("premiereTrackType"),
    currentExplodedTrackIndex: track.getAttribute("currentExplodedTrackIndex"),
    totalExplodedTrackCount: track.getAttribute("totalExplodedTrackCount"),
    enabled: text(track, "enabled"),
    locked: text(track, "locked"),
    outputchannelindex: text(track, "outputchannelindex"),
    clips: children(track, "clipitem").map((clip) => ({
      premiereChannelType: clip.getAttribute("premiereChannelType"),
      masterclipid: text(clip, "masterclipid"),
      name: text(clip, "name"),
      enabled: text(clip, "enabled"),
      duration: text(clip, "duration"),
      timebase: text(clip, "rate/timebase"),
      ntsc: text(clip, "rate/ntsc"),
      start: text(clip, "start"),
      end: text(clip, "end"),
      in: text(clip, "in"),
      out: text(clip, "out"),
      refersToFile: child(clip, "file").getAttribute("id"),
      sourcetrack: {
        mediatype: text(clip, "sourcetrack/mediatype"),
        trackindex: text(clip, "sourcetrack/trackindex"),
      },
    })),
  }));
}

function audioSetup(root: Element) {
  const audio = child(root, "sequence/media/audio");
  return {
    numOutputChannels: text(audio, "numOutputChannels"),
    depth: text(audio, "format/samplecharacteristics/depth"),
    samplerate: text(audio, "format/samplecharacteristics/samplerate"),
    outputs: children(child(audio, "outputs"), "group").map((group) => ({
      index: text(group, "index"),
      numchannels: text(group, "numchannels"),
      downmix: text(group, "downmix"),
      channels: children(group, "channel").map((channel) => text(channel, "index")),
    })),
  };
}

function sequenceVideoFormat(root: Element) {
  const format = child(root, "sequence/media/video/format/samplecharacteristics");
  return {
    timebase: text(format, "rate/timebase"),
    ntsc: text(format, "rate/ntsc"),
    width: text(format, "width"),
    height: text(format, "height"),
    anamorphic: text(format, "anamorphic"),
    pixelaspectratio: text(format, "pixelaspectratio"),
    fielddominance: text(format, "fielddominance"),
    colordepth: text(format, "colordepth"),
  };
}

function sequenceTimecode(root: Element) {
  const timecode = child(root, "sequence/timecode");
  return {
    timebase: text(timecode, "rate/timebase"),
    ntsc: text(timecode, "rate/ntsc"),
    string: text(timecode, "string"),
    frame: text(timecode, "frame"),
    displayformat: text(timecode, "displayformat"),
  };
}

const MEDIA_TYPES = ["video", "audio"] as const;

/** Clip ids are arbitrary, so links are compared by where their target sits: media type, track number, place in track. */
function clipPositions(root: Element): Map<string, string> {
  const positions = new Map<string, string>();
  for (const mediaType of MEDIA_TYPES) {
    children(child(root, `sequence/media/${mediaType}`), "track").forEach((track, trackIndex) => {
      children(track, "clipitem").forEach((clip, clipIndex) => {
        const id = clip.getAttribute("id");
        if (!id) throw new Error(`clip ${clipIndex + 1} on ${mediaType} track ${trackIndex + 1} has no id`);
        positions.set(id, `${mediaType} track ${trackIndex + 1} clip ${clipIndex + 1}`);
      });
    });
  }
  return positions;
}

function clipLinks(root: Element) {
  const positions = clipPositions(root);
  const positionOf = (id: string | null) => {
    const position = id === null ? undefined : positions.get(id);
    if (!position) throw new Error(`link points at unknown clip ${id}`);
    return position;
  };
  return MEDIA_TYPES.flatMap((mediaType) =>
    tracksWithClips(root, mediaType).flatMap((track) =>
      children(track, "clipitem").map((clip) => ({
        clip: positionOf(clip.getAttribute("id")),
        links: children(clip, "link").map((link) => ({
          target: positionOf(text(link, "linkclipref")),
          mediatype: text(link, "mediatype"),
          trackindex: text(link, "trackindex"),
          clipindex: text(link, "clipindex"),
          groupindex: children(link, "groupindex").length > 0 ? text(link, "groupindex") : "absent",
        })),
      })),
    ),
  );
}

function clipTicks(root: Element) {
  return MEDIA_TYPES.flatMap((mediaType) =>
    tracksWithClips(root, mediaType).flatMap((track, trackIndex) =>
      children(track, "clipitem").map((clip, clipIndex) => ({
        clip: `${mediaType} track ${trackIndex + 1} clip ${clipIndex + 1}`,
        pproTicksIn: text(clip, "pproTicksIn"),
        pproTicksOut: text(clip, "pproTicksOut"),
      })),
    ),
  );
}

/** Every distinct frame rate written anywhere in the document. */
function allRates(root: Element): string[] {
  const rates = root.getElementsByTagName("rate");
  const found = new Set<string>();
  for (let i = 0; i < rates.length; i++) {
    const rate = rates.item(i);
    if (rate) found.add(`timebase ${text(rate, "timebase")}, ntsc ${text(rate, "ntsc")}`);
  }
  return [...found];
}

/** Every projection above in one object, to check a whole export against a fixture at once. */
function wholeSequence(root: Element) {
  return {
    summary: sequenceSummary(root),
    videoFormat: sequenceVideoFormat(root),
    timecode: sequenceTimecode(root),
    videoTracks: videoTracks(root),
    fileReferences: videoFileReferences(root),
    audioSetup: audioSetup(root),
    audioTracks: audioTracks(root),
    links: clipLinks(root),
    ticks: clipTicks(root),
  };
}

describe("exportFcp7Xml", () => {
  test("the sequence is named after the Recording and runs at its frame rate for the length of the CutPlan", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(sequenceSummary(exported)).toEqual(sequenceSummary(singleFixture));
  });

  test("the video TimelineTrack holds one clip per KeepSegment at its Recording and timeline position", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(videoTracks(exported)).toEqual(videoTracks(singleFixture));
  });

  test("the first clip defines the Recording file with its file URL, every later clip refers back to it", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(videoFileReferences(exported)).toEqual(videoFileReferences(singleFixture));
  });

  // CLAUDE.md / ADR-0002: one TimelineTrack per SourceTrack is what made every track import as mono.
  test("a stereo SourceTrack becomes two TimelineTracks, one per Channel, carrying the same clips", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(audioTracks(exported)).toEqual(audioTracks(singleFixture));
  });

  test("the sequence mixes to two outputs at the Recording's sample rate and bit depth", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(audioSetup(exported)).toEqual(audioSetup(singleFixture));
  });

  test("every clip links to all clips of its KeepSegment: the video and each Channel", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(clipLinks(exported)).toEqual(clipLinks(singleFixture));
  });

  test("the sequence frame has the Recording's resolution and frame rate", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(sequenceVideoFormat(exported)).toEqual(sequenceVideoFormat(singleFixture));
  });

  test("the sequence timecode starts at zero, counted in the Recording's frames", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(sequenceTimecode(exported)).toEqual(sequenceTimecode(singleFixture));
  });

  test("every clip carries its in and out point in Premiere ticks as well as in frames", () => {
    const exported = parseXml(exportFcp7Xml(singleRecording, singleCutPlan));

    expect(clipTicks(exported)).toEqual(clipTicks(singleFixture));
  });

  test("six stereo SourceTracks match Premiere's multitrack export, each cut to its own length", () => {
    const exported = parseXml(exportFcp7Xml(multitrackRecording, multitrackCutPlan));

    expect(wholeSequence(exported)).toEqual(wholeSequence(multitrackFixture));
  });

  // No fixture covers NTSC. FCP7 XML spells 29.97 fps as timebase 30 with the ntsc flag set.
  test("an NTSC Recording is marked as NTSC wherever a frame rate appears", () => {
    const ntscRecording = { ...singleRecording, frameRate: { numerator: 30000, denominator: 1001 } };
    const exported = parseXml(exportFcp7Xml(ntscRecording, singleCutPlan));

    expect(allRates(exported)).toEqual(["timebase 30, ntsc TRUE"]);
  });

  test("a file name with XML special characters comes through as plain text", () => {
    const recording = { ...singleRecording, path: "C:\\media\\Tom & Jerry's Run.mp4" };
    const exported = parseXml(exportFcp7Xml(recording, singleCutPlan));
    const firstClip = child(exported, "sequence/media/video/track/clipitem");

    expect([text(exported, "sequence/name"), text(firstClip, "name"), text(firstClip, "file/name")]).toEqual([
      "Tom & Jerry's Run",
      "Tom & Jerry's Run.mp4",
      "Tom & Jerry's Run.mp4",
    ]);
  });

  // Owner's decision: no real Premiere export covers other channel layouts yet, so refuse rather than guess.
  test("a SourceTrack that is not stereo is refused instead of exported as a guess", () => {
    const monoRecording = {
      ...singleRecording,
      sourceTracks: [{ channelCount: 1, sampleRate: 44100, bitDepth: 16, durationFrames: 4873 }],
    };

    expect(() => exportFcp7Xml(monoRecording, singleCutPlan)).toThrow(/SourceTrack 1 has 1 channel.*only stereo/);
  });

  // FCP7 XML expresses only whole frame rates and their NTSC variants (n × 1000/1001). Rounding would shift every cut.
  test("a frame rate FCP7 XML cannot express is refused instead of rounded", () => {
    const recording = { ...singleRecording, frameRate: { numerator: 25, denominator: 2 } };

    expect(() => exportFcp7Xml(recording, singleCutPlan)).toThrow(/12\.5 fps.*cannot be expressed/);
  });

  // No fixture shows how Premiere links a KeepSegment that one SourceTrack no longer covers.
  test("a KeepSegment starting after a SourceTrack has ended is refused instead of written as a negative clip", () => {
    const recording = {
      ...singleRecording,
      sourceTracks: [{ channelCount: 2, sampleRate: 44100, bitDepth: 16, durationFrames: 1800 }],
    };

    expect(() => exportFcp7Xml(recording, singleCutPlan)).toThrow(
      "KeepSegment 7 starts at frame 1828, after SourceTrack 1 ends at frame 1800",
    );
  });
});
