import { planCuts, type CutPlan, type TimeRange } from "../cutting/planCuts.ts";
import { decodeSourceTracks } from "../decode/decodeSourceTracks.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import { detectLoudness } from "../level/detectLoudness.ts";
import { probeRecording } from "../probe/probeRecording.ts";
import { detectSpeech, type MonoPcm } from "../speech/detectSpeech.ts";

/** What decides that a stretch is worth keeping. The owner picked loudness after listening to both (ADR-0003). */
export type Decision = { kind: "voice" } | { kind: "loudness"; thresholdDbfs: number };

/** What the user chose for one Recording. */
export interface AnalysisRequest {
  recordingPath: string;
  /** The Voice SourceTracks by position in the Recording, 0 being the first: they decide what is kept. */
  voiceSourceTracks: readonly number[];
  /** Defaults to the voice. */
  decideBy?: Decision;
  marginSeconds: number;
  /** ADR-0007: measured after the Margin is kept. */
  minimumDeadZoneSeconds: number;
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
): Promise<{
  recording: RecordingInfo;
  /** The decoded SourceTracks, kept so another threshold can be tried without reading the Recording (ADR-0004). */
  listened: readonly MonoPcm[];
  worthKeeping: readonly TimeRange[];
  cutPlan: CutPlan;
}> {
  // Without a SourceTrack to listen to nothing could ever be kept, so the Recording is not even read.
  if (request.voiceSourceTracks.length === 0) throw new Error("Choose at least one SourceTrack to listen to.");
  const decideBy: Decision = request.decideBy ?? { kind: "voice" };

  const recording = await probeRecording(request.recordingPath, tools.ffprobe);
  const listened = await decodeSourceTracks(recording, request.voiceSourceTracks, tools.ffmpeg);
  const worthKeeping = (
    await Promise.all(
      listened.map((pcm) =>
        decideBy.kind === "voice"
          ? detectSpeech(pcm, tools.sileroModel)
          : Promise.resolve(detectLoudness(pcm, decideBy.thresholdDbfs)),
      ),
    )
  ).flat();

  const cutPlan = planCuts({
    recording,
    // planCuts calls these the speech; with a loudness threshold they are simply the stretches loud enough to keep.
    speech: worthKeeping,
    // ContentEvents and LockedRanges do not exist yet.
    contentEvents: [],
    lockedRanges: [],
    marginSeconds: request.marginSeconds,
    eventLeadSeconds: 0,
    eventTailSeconds: 0,
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
  return { recording, listened, worthKeeping, cutPlan };
}
