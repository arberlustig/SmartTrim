# SmartTrim

SmartTrim finds the stretches of a long recording where nothing worth keeping happens, and writes an Adobe Premiere Pro project containing only the rest. It never modifies the recording itself.

## Source media

**Recording**:
The source video file the user hands to SmartTrim, typically a multi-hour OBS capture.
_Avoid_: video, clip, VOD, footage, input

**SourceTrack**:
One audio track inside a Recording. OBS writes several — commonly microphone, game audio, and unused placeholders.
_Avoid_: track, audio track, stream

**Channel**:
One side of a stereo SourceTrack. A SourceTrack has two; Premiere addresses them separately.
_Avoid_: track, side

**EmptyTrack**:
A SourceTrack that carries no real audio because the user never routed anything to it. SmartTrim hides these rather than asking the user about them, and leaves them out of the export as well — what the window shows is what it exports (ADR-0014). Since it is judged from samples (ADR-0013), the window can always show them again.
_Avoid_: silent track, unused track, dead track

**Interleaving**:
How finely a Recording alternates between video and audio data on disk. Coarse interleaving lets a reader skip most of the file; fine interleaving forces it to read nearly all of it.
_Avoid_: chunking, layout

## Analysis

**TrackRole**:
What a SourceTrack contributes to the cutting decision. Exactly one of Voice, Content or Ignored.

**Voice**:
The TrackRole for tracks whose speech drives cutting — normally the microphone.

**Content**:
The TrackRole for tracks that can keep material alive through a ContentEvent, without their steady level mattering.

**Ignored**:
The TrackRole for tracks that never influence cutting, such as alert sounds or a reacted-to video.

**ContentEvent**:
A moment where a Content track departs noticeably from its own recent baseline — an explosion, a fanfare, an abrupt drop. Continuous background audio is never a ContentEvent, however loud.
_Avoid_: peak, loud part, spike

**EventLead**:
Time kept before a ContentEvent so the viewer sees what led up to it. Set per Preset; takes the place of Margin for ContentEvents.
_Avoid_: pre-roll, Margin

**EventTail**:
Time kept after a ContentEvent. Set per Preset; takes the place of Margin for ContentEvents.
_Avoid_: post-roll, Margin

**DeadZone**:
A stretch of a Recording carrying no speech, no ContentEvent and no LockedRange — nor any Margin, EventLead or EventTail kept around them — lasting at least the MinimumDeadZone. This is exactly what SmartTrim removes, so no removed stretch is ever shorter than the MinimumDeadZone.
_Avoid_: silence, gap, pause, quiet part

**KeepSegment**:
A stretch of a Recording that survives cutting, described by its position in the Recording and its position on the timeline.
_Avoid_: clip, keep range, chunk

**Margin**:
Extra time kept on each side of speech so that it is not clipped at a KeepSegment boundary. ContentEvents use EventLead and EventTail instead; LockedRanges get none.
_Avoid_: padding, buffer, offset

**MinimumDeadZone**:
How long a DeadZone must last before SmartTrim removes it, measured *after* Margin, EventLead and EventTail have been kept: a 2.2 s pause with 0.3 s Margin on both sides leaves 1.6 s, which a 2 s MinimumDeadZone does not remove. The main thing that separates one Preset from another.
_Avoid_: threshold, min silence

**LockedRange**:
A time range the user marks so that SmartTrim never removes anything inside it. Its edges are exact — no Margin is added — but a pause beside it follows the same MinimumDeadZone rule as a pause beside speech.
_Avoid_: protected zone, do-not-touch, safe zone

**SourceTrackScan**:
What listening to a few short slices of a SourceTrack found: whether it carries sound at all, and in how many of the
slices. It decides which SourceTracks are EmptyTracks and therefore hidden, and it is a sample, never proof (ADR-0013).
_Avoid_: analysis, level check, probe

**Preset**:
A named set of TrackRoles and thresholds suited to a kind of video, such as Gaming, Reaction or Podcast.

## Output

**CutPlan**:
The ordered KeepSegments produced by analysing a Recording — the complete description of what the finished edit contains.
_Avoid_: cutlist, EDL, timeline, edit list

**ExportedSourceTrack**:
A SourceTrack the user kept in the Premiere sequence. Which SourceTracks are exported is a separate choice from which
ones the cut is decided by; every SourceTrack a scan found sound on starts exported, and so does every SourceTrack of
a Recording nothing was scanned on (ADR-0014).
_Avoid_: selected track, output track

**TimelineTrack**:
One audio track in the exported Premiere sequence. Premiere explodes every stereo SourceTrack into two TimelineTracks, one per Channel.
_Avoid_: track, output track

**TrimProject**:
SmartTrim's own saved file, holding the Recording reference, TrackRoles, settings and CutPlan, so that a session can be reopened and re-exported without analysing the Recording again.
_Avoid_: project file, session, save file

**Cut** (verb):
To remove a DeadZone. Note that in Premiere "cut" means splitting a clip *without* removing anything — prefer "remove" or "split" wherever the sentence could be read either way.

## Window

**CutSession**:
Everything the window remembers about one planned cut: the chosen Recording, the SourceTracks ticked to listen to,
and the three settings. It is replaced, never changed in place, and knows nothing about how it is drawn.
_Avoid_: state, settings object, form, config

**CutSummary**:
What the window says about a finished CutPlan — how much of the Recording survives, how much SmartTrim removes and
in how many KeepSegments. The plan itself stays in the main process (ADR-0012).
_Avoid_: stats, report, result
