import { win32 } from "node:path";
import type { CutPlan, FrameRate } from "../cutting/planCuts";

/** One audio SourceTrack of the Recording, as probed. */
export interface SourceTrackInfo {
  channelCount: number;
  sampleRate: number;
  bitDepth: number;
  /**
   * This SourceTrack's length in whole frames as Premiere counts it, not as the file holds it: the first SourceTrack
   * runs as long as the video, every later one ends at its last whole frame (ADR-0009).
   */
  durationFrames: number;
}

/** Everything the export needs to know about the Recording. Every value is probed, never assumed. */
export interface RecordingInfo {
  /** Absolute path as the operating system spells it. */
  path: string;
  frameRate: FrameRate;
  width: number;
  height: number;
  /** Length of the video in whole frames. */
  durationFrames: number;
  /** Audio SourceTracks in the order they appear in the file. */
  sourceTracks: readonly SourceTrackInfo[];
}

/**
 * FCP7 XML spells a frame rate as a whole timebase plus an NTSC flag: 60/1 is timebase 60, 30000/1001 is timebase 30
 * with ntsc TRUE. Any other rate cannot be written, and rounding it would shift every cut.
 */
function toFcp7Rate({ numerator, denominator }: FrameRate): { timebase: number; ntsc: "TRUE" | "FALSE" } {
  const framesPerSecond = numerator / denominator;
  if (Number.isInteger(framesPerSecond)) return { timebase: framesPerSecond, ntsc: "FALSE" };
  const ntscTimebase = (numerator * 1001) / (denominator * 1000);
  if (Number.isInteger(ntscTimebase)) return { timebase: ntscTimebase, ntsc: "TRUE" };
  throw new Error(
    `Frame rate ${numerator}/${denominator} (${Number(framesPerSecond.toFixed(3))} fps) cannot be expressed in FCP7 XML.`,
  );
}

/** For text placed between tags. The file URL needs none of this: encodeURIComponent already turns & into %26. */
function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Premiere writes lowercase escapes and escapes the drive colon: C:\a b.mp4 → file://localhost/C%3a/a%20b.mp4 */
function toPathUrl(path: string): string {
  const segments = path
    .split(/[\\/]/)
    .map((segment) => encodeURIComponent(segment).replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()));
  return `file://localhost/${segments.join("/")}`;
}

/**
 * Renders a CutPlan as FCP7 XML (xmeml version 4) that references the Recording itself (ADR-0006).
 *
 * `exportSourceTracks` names the SourceTracks the sequence gets TimelineTracks for, by position in the Recording;
 * by default every one of them, so a SourceTrack is only ever left out because the user said so. The Channel
 * numbers of the SourceTracks that stay do not change (ADR-0014).
 */
export function exportFcp7Xml(
  recording: RecordingInfo,
  cutPlan: CutPlan,
  exportSourceTracks?: readonly number[],
): string {
  const parsedPath = win32.parse(recording.path);
  const name = escapeXml(parsedPath.name);
  const fileName = escapeXml(parsedPath.base);
  const { timebase, ntsc } = toFcp7Rate(recording.frameRate);
  // Premiere's own time unit is 254016000000 ticks per second. Dividing per frame first keeps the numbers exact:
  // multiplying frames by 254016000000 × 1001 first would pass 2^53 within a few dozen frames at 29.97.
  const ticksPerFrame = (254_016_000_000 * recording.frameRate.denominator) / recording.frameRate.numerator;
  const duration = cutPlan.at(-1)?.timelineEnd ?? 0;
  const firstSourceTrack = recording.sourceTracks[0];
  if (!firstSourceTrack) throw new Error("A Recording without audio SourceTracks cannot be exported.");

  // The positions to export, in the Recording's own order and without repeats, so the TimelineTracks come out in the
  // order the user sees them.
  const positions = [...new Set(exportSourceTracks ?? recording.sourceTracks.map((_sourceTrack, index) => index))]
    .sort((left, right) => left - right);
  for (const position of positions) {
    if (position < 0 || position >= recording.sourceTracks.length) {
      throw new Error(
        `SourceTrack ${position + 1} cannot be exported: the Recording has ${recording.sourceTracks.length}.`,
      );
    }
  }
  // A sequence with no audio at all looks like a finished edit whose sound was lost.
  if (positions.length === 0) throw new Error("Choose at least one SourceTrack to export.");

  /** The exported SourceTracks with the position each one has in the Recording. */
  const exported = positions.map((position) => ({
    position,
    sourceTrack: recording.sourceTracks[position] as SourceTrackInfo,
  }));

  // Both fixtures are stereo only. The owner chose to refuse other channel layouts until a real Premiere export
  // shows how they look, rather than guess — a guess is exactly how the predecessor imported everything as mono.
  // A SourceTrack nobody exports is never written, so its layout does not matter.
  for (const { position, sourceTrack } of exported) {
    if (sourceTrack.channelCount !== 2) {
      throw new Error(
        `SourceTrack ${position + 1} has ${sourceTrack.channelCount} channel(s); only stereo SourceTracks can be exported so far.`,
      );
    }
  }
  // A SourceTrack can end a few frames before the video. No fixture shows what Premiere does with a KeepSegment lying
  // entirely past that end, and writing one anyway would produce an audio clip of negative length.
  for (const { position, sourceTrack } of exported) {
    cutPlan.forEach((segment, segmentIndex) => {
      if (segment.recordingIn >= sourceTrack.durationFrames) {
        throw new Error(
          `KeepSegment ${segmentIndex + 1} starts at frame ${segment.recordingIn}, after SourceTrack ${position + 1} ends at frame ${sourceTrack.durationFrames}.`,
        );
      }
    });
  }

  // Clips are numbered the way Premiere numbers them: the video TimelineTrack first, then each audio TimelineTrack.
  // These are the sequence's own TimelineTracks, so only the exported SourceTracks count.
  const audioTimelineTrackCount = exported.length * 2;
  const clipId = (timelineTrackOffset: number, segmentIndex: number) =>
    `clipitem-${timelineTrackOffset * cutPlan.length + segmentIndex + 1}`;

  // Every clip of a KeepSegment links to all clips of that KeepSegment, itself included.
  const links = (segmentIndex: number) =>
    `
						<link>
							<linkclipref>${clipId(0, segmentIndex)}</linkclipref>
							<mediatype>video</mediatype>
							<trackindex>1</trackindex>
							<clipindex>${segmentIndex + 1}</clipindex>
						</link>` +
    Array.from(
      { length: audioTimelineTrackCount },
      (_, trackIndex) => `
						<link>
							<linkclipref>${clipId(trackIndex + 1, segmentIndex)}</linkclipref>
							<mediatype>audio</mediatype>
							<trackindex>${trackIndex + 1}</trackindex>
							<clipindex>${segmentIndex + 1}</clipindex>
							<groupindex>1</groupindex>
						</link>`,
    ).join("");

  const audioDescriptions = recording.sourceTracks
    .map(
      (sourceTrack) => `
								<audio>
									<samplecharacteristics>
										<depth>${sourceTrack.bitDepth}</depth>
										<samplerate>${sourceTrack.sampleRate}</samplerate>
									</samplecharacteristics>
									<channelcount>${sourceTrack.channelCount}</channelcount>
								</audio>`,
    )
    .join("");

  const fileDefinition = `
						<file id="file-1">
							<name>${fileName}</name>
							<pathurl>${toPathUrl(recording.path)}</pathurl>
							<rate>
								<timebase>${timebase}</timebase>
								<ntsc>${ntsc}</ntsc>
							</rate>
							<duration>${recording.durationFrames}</duration>
							<timecode>
								<rate>
									<timebase>${timebase}</timebase>
									<ntsc>${ntsc}</ntsc>
								</rate>
								<string>00:00:00:00</string>
								<frame>0</frame>
								<displayformat>NDF</displayformat>
							</timecode>
							<media>
								<video>
									<samplecharacteristics>
										<rate>
											<timebase>${timebase}</timebase>
											<ntsc>${ntsc}</ntsc>
										</rate>
										<width>${recording.width}</width>
										<height>${recording.height}</height>
										<anamorphic>FALSE</anamorphic>
										<pixelaspectratio>square</pixelaspectratio>
										<fielddominance>none</fielddominance>
									</samplecharacteristics>
								</video>${audioDescriptions}
							</media>
						</file>`;

  const videoClips = cutPlan
    .map(
      (segment, index) => `
					<clipitem id="${clipId(0, index)}">
						<masterclipid>masterclip-1</masterclipid>
						<name>${fileName}</name>
						<enabled>TRUE</enabled>
						<duration>${recording.durationFrames}</duration>
						<rate>
							<timebase>${timebase}</timebase>
							<ntsc>${ntsc}</ntsc>
						</rate>
						<start>${segment.timelineStart}</start>
						<end>${segment.timelineEnd}</end>
						<in>${segment.recordingIn}</in>
						<out>${segment.recordingOut}</out>
						<pproTicksIn>${segment.recordingIn * ticksPerFrame}</pproTicksIn>
						<pproTicksOut>${segment.recordingOut * ticksPerFrame}</pproTicksOut>${index === 0 ? fileDefinition : `
						<file id="file-1"/>`}${links(index)}
					</clipitem>`,
    )
    .join("");

  // <sourcetrack><trackindex> is a Channel number counted across all SourceTracks of the Recording: 1, 2 | 3, 4 | …
  // It says which Channel of the file to play, so it counts SourceTracks that are not exported as well (ADR-0014).
  // Premiere's own multi-track export writes the SourceTrack's number instead (1, 1, 2, 2, …), and a real import
  // proved Premiere misreads that: stereo spread over two TimelineTracks and louder on the left (ADR-0008).
  // Every SourceTrack is stereo by now, so each SourceTrack before this one accounts for two Channels.
  const sourceTrackReference = (sourceTrackIndex: number, channel: number) => sourceTrackIndex * 2 + channel;

  // Each SourceTrack keeps its own length: a SourceTrack that ends before the video ends its clips there.
  const audioClips = (timelineTrackNumber: number, sourceTrack: SourceTrackInfo, trackIndexInSource: number) =>
    cutPlan
      .map((segment, index) => {
        const out = Math.min(segment.recordingOut, sourceTrack.durationFrames);
        return `
					<clipitem id="${clipId(timelineTrackNumber, index)}" premiereChannelType="stereo">
						<masterclipid>masterclip-1</masterclipid>
						<name>${fileName}</name>
						<enabled>TRUE</enabled>
						<duration>${sourceTrack.durationFrames}</duration>
						<rate>
							<timebase>${timebase}</timebase>
							<ntsc>${ntsc}</ntsc>
						</rate>
						<start>${segment.timelineStart}</start>
						<end>${segment.timelineStart + out - segment.recordingIn}</end>
						<in>${segment.recordingIn}</in>
						<out>${out}</out>
						<pproTicksIn>${segment.recordingIn * ticksPerFrame}</pproTicksIn>
						<pproTicksOut>${out * ticksPerFrame}</pproTicksOut>
						<file id="file-1"/>
						<sourcetrack>
							<mediatype>audio</mediatype>
							<trackindex>${trackIndexInSource}</trackindex>
						</sourcetrack>${links(index)}
					</clipitem>`;
      })
      .join("");

  // ADR-0002: Premiere explodes every stereo SourceTrack into two TimelineTracks, one per Channel.
  const audioTimelineTracks = exported
    .flatMap(({ position, sourceTrack }, order) =>
      [1, 2].map(
        (channel) => `
				<track premiereTrackType="Stereo" currentExplodedTrackIndex="${channel - 1}" totalExplodedTrackCount="2">${audioClips(order * 2 + channel, sourceTrack, sourceTrackReference(position, channel))}
					<enabled>TRUE</enabled>
					<locked>FALSE</locked>
					<outputchannelindex>${channel}</outputchannelindex>
				</track>`,
      ),
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
	<sequence explodedTracks="true">
		<duration>${duration}</duration>
		<rate>
			<timebase>${timebase}</timebase>
			<ntsc>${ntsc}</ntsc>
		</rate>
		<name>${name}</name>
		<media>
			<video>
				<format>
					<samplecharacteristics>
						<rate>
							<timebase>${timebase}</timebase>
							<ntsc>${ntsc}</ntsc>
						</rate>
						<width>${recording.width}</width>
						<height>${recording.height}</height>
						<anamorphic>FALSE</anamorphic>
						<pixelaspectratio>square</pixelaspectratio>
						<fielddominance>none</fielddominance>
						<colordepth>24</colordepth>
					</samplecharacteristics>
				</format>
				<track>${videoClips}
					<enabled>TRUE</enabled>
					<locked>FALSE</locked>
				</track>
			</video>
			<audio>
				<numOutputChannels>2</numOutputChannels>
				<format>
					<samplecharacteristics>
						<depth>${firstSourceTrack.bitDepth}</depth>
						<samplerate>${firstSourceTrack.sampleRate}</samplerate>
					</samplecharacteristics>
				</format>
				<outputs>
					<group>
						<index>1</index>
						<numchannels>1</numchannels>
						<downmix>0</downmix>
						<channel>
							<index>1</index>
						</channel>
					</group>
					<group>
						<index>2</index>
						<numchannels>1</numchannels>
						<downmix>0</downmix>
						<channel>
							<index>2</index>
						</channel>
					</group>
				</outputs>${audioTimelineTracks}
			</audio>
		</media>
		<timecode>
			<rate>
				<timebase>${timebase}</timebase>
				<ntsc>${ntsc}</ntsc>
			</rate>
			<string>00:00:00:00</string>
			<frame>0</frame>
			<displayformat>NDF</displayformat>
		</timecode>
	</sequence>
</xmeml>
`;
}
