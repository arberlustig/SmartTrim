import { planCuts, type CutPlan, type TimeRange } from "../cutting/planCuts.ts";
import { decodeSourceTracks } from "../decode/decodeSourceTracks.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import { contentEventsFrom } from "../level/detectContentEvents.ts";
import { SAMPLE_RATE, chunkLevelsDbfs, loudRanges, type ChunkLevels } from "../level/detectLoudness.ts";
import { probeRecording } from "../probe/probeRecording.ts";
import { detectSpeech, type MonoPcm } from "../speech/detectSpeech.ts";
import { PEAKS_PER_SECOND, peakEnvelope } from "../waveform/peakEnvelope.ts";

/** What decides that a stretch is worth keeping. The owner picked loudness after listening to both (ADR-0003). */
export type Decision = { kind: "voice" } | { kind: "loudness"; thresholdDbfs: number };

/** What the user chose for one Recording. */
export interface AnalysisRequest {
  recordingPath: string;
  /** The Voice SourceTracks by position in the Recording, 0 being the first: they decide what is kept. */
  voiceSourceTracks: readonly number[];
  /**
   * The Content SourceTracks by position: they keep material alive through a ContentEvent — an explosion, a
   * fanfare, an abrupt drop — without their steady level mattering (CONTEXT.md).
   */
  contentSourceTracks?: readonly number[];
  /** Defaults to the voice. */
  decideBy?: Decision;
  marginSeconds: number;
  /** Kept before a ContentEvent, in place of the Margin. */
  eventLeadSeconds?: number;
  /** Kept after a ContentEvent, in place of the Margin. */
  eventTailSeconds?: number;
  /** ADR-0007: measured after the Margin is kept. */
  minimumDeadZoneSeconds: number;
}

/**
 * What one SourceTrack leaves behind once it has been read: how loud each of its chunks is, and the heights the
 * window draws its waveform from. The samples themselves are let go — 278 MB of them per SourceTrack on a 2.5-hour
 * Recording, and nothing the window can do reads them again (ADR-0021).
 */
export interface ReadSourceTrack extends ChunkLevels {
  position: number;
  peaksPerSecond: number;
  peaks: Float32Array;
}

/**
 * Reads a decoded SourceTrack down to what is worth keeping: its chunk levels and its waveform. The audio is not
 * part of what comes back, so once the caller lets go of it, it is gone.
 */
export function readSourceTrackFrom(position: number, pcm: MonoPcm): ReadSourceTrack {
  // The chunks become seconds at 16 kHz; audio at another rate would put every level at the wrong time.
  if (pcm.sampleRate !== SAMPLE_RATE) {
    throw new Error(`SourceTrack ${position + 1} was decoded at ${pcm.sampleRate} Hz, not ${SAMPLE_RATE} Hz.`);
  }
  return {
    position,
    levelsDbfs: Float64Array.from(chunkLevelsDbfs(pcm)),
    peaksPerSecond: PEAKS_PER_SECOND,
    peaks: peakEnvelope(pcm, PEAKS_PER_SECOND),
  };
}

/** Where ffprobe, ffmpeg and the Silero model are: vendor/ during development. */
export interface AnalysisTools {
  ffprobe: string;
  ffmpeg: string;
  sileroModel: string;
}

/**
 * Analyses a Recording into a CutPlan: probes it, decodes the chosen SourceTracks once, finds what is worth keeping
 * on them and plans the cuts around it. The Recording is only read, never written (ADR-0006).
 */
export async function analyseRecording(
  request: AnalysisRequest,
  tools: AnalysisTools,
  /**
   * SourceTracks whose audio the window already read to draw their waveform (ADR-0020). Only the ones missing from
   * here are read from the Recording, which is what keeps ADR-0004's promise that it is read once, not twice.
   */
  alreadyRead: readonly ReadSourceTrack[] = [],
): Promise<{
  recording: RecordingInfo;
  /**
   * The chunk levels of the Voice SourceTracks, kept so another threshold can be tried without a new read
   * (ADR-0004).
   */
  listened: readonly ChunkLevels[];
  /**
   * Every SourceTrack that was read, Voice and Content alike, by its position in the Recording — its chunk levels
   * and its waveform, never its audio (ADR-0021). A SourceTrack with no role was never read (ADR-0019).
   */
  read: readonly ReadSourceTrack[];
  worthKeeping: readonly TimeRange[];
  /** The moments found on the Content SourceTracks. */
  contentEvents: readonly TimeRange[];
  cutPlan: CutPlan;
}> {
  // Without a SourceTrack to listen to nothing could ever be kept, so the Recording is not even read.
  if (request.voiceSourceTracks.length === 0) throw new Error("Choose at least one SourceTrack to listen to.");
  const decideBy: Decision = request.decideBy ?? { kind: "voice" };

  const recording = await probeRecording(request.recordingPath, tools.ffprobe);

  // Voice and Content SourceTracks are decoded in one go: the Recording is read once, whatever it is listened to
  // for (ADR-0004). A SourceTrack named twice is decoded once.
  const content = request.contentSourceTracks ?? [];
  const wanted = [...new Set([...request.voiceSourceTracks, ...content])];
  // Only what nobody has read yet. A SourceTrack the waveform already needed is taken as it is, so the Recording
  // is still read once for it and not twice (ADR-0004, ADR-0020). The one exception is deciding by voice: Silero
  // scores samples, not levels, so its SourceTracks' audio is decoded again.
  const known = new Map(alreadyRead.map((read) => [read.position, read]));
  const needSamples = decideBy.kind === "voice" ? request.voiceSourceTracks : [];
  const toDecode = wanted.filter((position) => !known.has(position) || needSamples.includes(position));
  const fresh = toDecode.length === 0 ? [] : await decodeSourceTracks(recording, toDecode, tools.ffmpeg);
  // The audio lives only as long as this call. What outlives it is each SourceTrack read down to levels and peaks.
  const samplesOf = new Map(toDecode.map((position, index) => [position, fresh[index] as MonoPcm]));
  for (const [position, pcm] of samplesOf) {
    if (!known.has(position)) known.set(position, readSourceTrackFrom(position, pcm));
  }
  const readOf = (position: number) => known.get(position) as ReadSourceTrack;

  const listened = request.voiceSourceTracks.map(readOf);
  const worthKeeping =
    decideBy.kind === "voice"
      ? (
          await Promise.all(
            request.voiceSourceTracks.map((position) =>
              detectSpeech(samplesOf.get(position) as MonoPcm, tools.sileroModel),
            ),
          )
        ).flat()
      : listened.flatMap((levels) => loudRanges(levels, decideBy.thresholdDbfs));
  const contentEvents = content.flatMap((position) => contentEventsFrom(readOf(position)));

  const cutPlan = planCuts({
    recording,
    // planCuts calls these the speech; with a loudness threshold they are simply the stretches loud enough to keep.
    speech: worthKeeping,
    contentEvents,
    // LockedRanges do not exist yet.
    lockedRanges: [],
    marginSeconds: request.marginSeconds,
    eventLeadSeconds: request.eventLeadSeconds ?? 0,
    eventTailSeconds: request.eventTailSeconds ?? 0,
    minimumDeadZoneSeconds: request.minimumDeadZoneSeconds,
  });

  // An empty CutPlan would export as an empty sequence, which looks like a finished edit with nothing in it.
  if (cutPlan.length === 0) {
    const numbers = request.voiceSourceTracks.map((index) => index + 1);
    const sourceTracks = `SourceTrack${numbers.length === 1 ? "" : "s"} ${numbers.join(", ")}`;
    throw new Error(
      decideBy.kind === "voice"
        ? `Nobody speaks on ${sourceTracks}, so nothing would be kept. Choose the SourceTracks someone speaks on.`
        : `Nothing on ${sourceTracks} reaches ${decideBy.thresholdDbfs} dBFS, so nothing would be kept. Lower the threshold or choose other SourceTracks.`,
    );
  }
  return { recording, listened, read: wanted.map(readOf), worthKeeping, contentEvents, cutPlan };
}
