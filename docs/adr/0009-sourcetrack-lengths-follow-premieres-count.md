# SourceTrack lengths follow Premiere's count, not the file's

`recordingInfoFromProbe` turns ffprobe's stream description into the RecordingInfo the export needs. Frame rate, resolution, video length, Channel count and sample rate are taken as ffprobe reports them. SourceTrack lengths are not: the probe gives the **first SourceTrack the video's length** and ends **every later SourceTrack at its last whole frame**, because that is how Premiere counted them in both of its exports, although the file says otherwise.

The tests replay real ffprobe output for the two Recordings behind `fixtures/premiere/`, kept in `fixtures/ffprobe/`, and expect the values Premiere wrote.

## Measured on 2026-09-11

| | long-recording.mp4 (6 SourceTracks, 60 fps) | single-track (1 SourceTrack, 30 fps) |
|---|---|---|
| video | 546692 frames | 4873 frames |
| each SourceTrack in the file | 546690.56 frames | 4873.40 frames |
| Premiere, SourceTrack 1 | 546692 | 4873 |
| Premiere, later SourceTracks | 546690 | — |

In long-recording.mp4 the six audio streams are identical down to the MP4 boxes: the same edit list (9111509 ms from media time 1024), 427103 packets of 1024 samples each, the last ending at sample 437352448. Nothing in the file sets SourceTrack 1 apart, so its 546692 frames cannot come from its audio; they are the video's length. The five later SourceTracks are rounded down — rounding to nearest would give 546691.

The single-track Recording agrees but cannot tell the rules apart: its audio runs longer than its video, so the video's length and rounding down both give 4873. The rule therefore rests on one SourceTrack that separates them. Nothing shows what Premiere does when the first SourceTrack ends more than a frame or two before the video, or a later one runs past it. OBS writes every audio stream at the same length, so neither has come up; a Premiere export of such a Recording would settle it.

## Considered Options

- **Every SourceTrack rounded down, the first included** — matches five of the long Recording's six SourceTracks and ends SourceTrack 1 two frames before Premiere does. Never imported; the demo cut the owner imported on 2026-09-11 used Premiere's own lengths.
- **Counting samples at the end of each stream** instead of ffprobe's `duration_ts`. `duration_ts` comes from the edit list, which OBS writes in milliseconds, so in long-recording.mp4 it stops 16 samples before the last packet ends. That changes the rounded-down frame only when a SourceTrack ends within a few hundredths of a frame after a frame boundary, and reading packet timestamps means reading into the file (ADR-0004). Both Recordings give the same frames either way.

## Refused rather than guessed

- **A variable frame rate.** The video's frame count must fill its duration at `r_frame_rate` to within **less than half a frame**, compared as exact fractions; otherwise every cut would drift. Until 2026-10-23 it had to fill it exactly, until 2026-10-24 to within a millisecond — see "Loosened by a millisecond" and "Loosened to half a frame" below.
- **A video frame rate with a zero in it.** ffprobe reports 1/0 for a video whose frames all share one moment; every other check divides by the frame rate.
- **A value ffprobe does not report.** Matroska, for one, reports no `duration_ts` or `nb_frames` per stream, so MKV Recordings are refused until someone measures how to read their lengths.
- **Audio codecs other than AAC that report no bit depth**, such as Opus. AAC reports none either; both Premiere exports write 16 for it. Codecs with a bit depth of their own, like PCM, keep theirs.
- **Anything but exactly one video stream.** ffprobe lists a cover picture as a video stream too.
- **A stream that starts half a frame or more before or after the Recording.** The export places every SourceTrack's clips at the same Recording frames as the video's, and the audio is read from its own first sample. Until 2026-10-24 every stream had to start at pts 0 exactly.

## Loosened by a millisecond (2026-10-23)

The exact check refused a 30-minute OBS Recording (60 fps, six stereo SourceTracks) with "109205 video frames, but its
video lasts 109204.98 frames". Its video counts time in 1/15360 s, 256 ticks a frame. Reading every packet showed all
109205 frames exactly on their slot (pts = 256 k) and every one 256 ticks long, so the last ends at 27956480 — but the
stream reports `duration_ts` 27956475. OBS writes the length in whole milliseconds, 1820.083 s for 1820.0833… s, the
same millisecond rounding this ADR found in the audio's edit lists. At 60 fps a length is a whole millisecond only when
the frame count divides by three, so roughly two OBS Recordings in three were refused although nothing about them
varies. The two fixtures count video time in 1/60 s and 1/15360 s with a frame count that happens to fit, which is why
nothing was refused before.

The check now allows the frames and the duration to differ by less than one millisecond, either way — the precision
the length is written in, and far below a frame (16.7 ms at 60 fps), so a real variable frame rate is still refused.
`durationFrames` stays `nb_frames`: the frames are all there. Tested with the Recording's own numbers in
`probeRecording.test.ts`, and the Recording cut end to end: 81 KeepSegments, the last ending at frame 109205.

Not checked: whether Premiere counts such a video as 109205 frames, like ffprobe's `nb_frames`, or reads the
millisecond length and makes it 109204. Only the last KeepSegment touches that frame; a real import of a cut that keeps
the end of such a Recording settles it.

The millisecond lasted a day; see the next section.

## Loosened to half a frame (2026-10-24)

Two users of SmartTrim 1.2.0 had a Recording refused. One, 78 minutes long from an unknown recorder: "280522 video
frames, but its video lasts 280521.9 frames at 60/1 fps". The other, named the way OBS names its recordings: "the video
stream starts at pts 90, not at the start of the Recording". Neither file was at hand, and the second refusal did not
say its time base.

**The frame count.** Four NVIDIA App recordings on the owner's machine (60 fps, video in 1/90000 s, 9 s to 331 s) stamp
every frame with a jittered capture time: frames last 1300 to 1658 ticks instead of 1500, yet none lies more than
1.9 ms from its slot k/60 s and none is missing or doubled. The largest deviation is about the same in the 9 s files
and the 331 s one, but within the 331 s file the deviations wandered by about 0.6 ms, −7.75 ms an hour fitted. The
video's duration is the last frame's jittered time plus its own jittered length, so it misses `nb_frames` by up to
2 ms — 1.58 and 1.99 ms short, 0.58 short, 1.00 long; three of the four were refused by the millisecond. The user's
Recording missed by 0.1 frame, 1.7 ms, after 78 minutes: the same size. A frame dropped or doubled moves the count by a
whole frame, 0.88 to 1.12 with that jitter on top. Half a frame lies between the two with room on both sides — 8.3 ms
at 60 fps, four times the largest jitter, 0.38 frame inside the nearest real error — so the check is now
|frames − spanned| < ½ frame, as exact fractions: `nb_frames` is the spanned frames rounded. `durationFrames` stays
`nb_frames`. Up to 500 fps half a frame is at least a millisecond, so everything the millisecond accepted still passes
with the same RecordingInfo; above 500 fps the rule is now stricter, since a millisecond there is more than half a
frame — a frame dropped, by the reasoning above.

**Where a stream starts.** ffprobe's `start_pts` counts in the stream's own time base, so pts 90 is 1.5 s in OBS's
hybrid MP4 at 60 fps (its video time base is one frame there; at 59.94 fps it is 1/60000 s, and pts 90 is 1.5 ms),
5.9 ms in OBS's ffmpeg MP4 (1/15360 s at 60 fps), and exactly 1 ms in 1/90000 s — the video time base of OBS's remux to
MP4, which leaves it to ffmpeg's default. OBS 32's source writes no empty edit into hybrid MP4 and starts every stream
at 0 in its ffmpeg MP4, while ffmpeg's MP4 muxer writes a stream that starts late as an empty edit: the millisecond is
the likely reading, although no OBS path tried here left a video exactly a millisecond late. A Recording remuxed with
its video a millisecond
late reproduces the refusal word for word (`probeRecording.test.ts`). On generated Recordings whose video started up to
5.9 ms late, the 16 kHz decode, the picture, the Excerpt and the scan gave exactly what they give when it starts at 0;
the picture did so up to half a frame.

A stream that starts less than half a frame before or after the Recording now counts as starting with it, video and
audio alike: the export writes whole frames, so no position in it can tell the two apart. Its RecordingInfo is what a
start at 0 gives, so nothing about a Recording accepted before changes.

Still refused, with the distance in milliseconds and the pts with its time base in the reason, so the next report says
which reading was meant:

- **A start half a frame or more away.** A video 1.5 s late would need more than accepting it: `durationFrames` would
  have to be where it ends, start plus `nb_frames`; the Excerpt and the scan seek on the video (`-ss` before `-i`) and
  read none of the sound before it begins; the picture repeats its first frame until then. And nothing shows whether
  Premiere honours an empty edit or pulls the video to 0.
- **AAC priming left in front of the sound** (start_pts −1024 at 48 kHz, 21.3 ms early), at every common frame rate
  from 23.976 fps up.

Considered: proving from every frame's own time that it sits on its slot, which neither check can — a frame dropped
and another doubled cancel out in the count. Through ffprobe's packets that reads through the Recording a second time
(ADR-0004). The MP4 sample tables in `moov` hold the same times — read that way, 402 KB of a 1.2 GB NVIDIA App
recording gave every frame's pts exactly as ffprobe's packets did — but SmartTrim would need a box parser of its own.
Not built.

The window's picture is made by seeking to a frame's slot (ADR-0028), and ffmpeg keeps nothing stamped before it. On
a jittered Recording a run that starts on a frame stamped early skips it and stays one frame off until the next run
(measured on a generated file); the cut is not affected. At the last frame the run made nothing at all, and three such
runs were reported as a picture that cannot be shown. A silent empty run at the last frame now lets the frame before
stand in, as for frames a Recording promises but lacks (`pictureFrames.test.ts`).

Not checked:

- How Premiere counts and places an NVIDIA App recording. Adobe names ShadowPlay among typical sources of variable
  frame rate; whether Premiere flags these files so, and then by default adds or drops frames to keep the sound in
  sync, is not known. With every frame on its slot that should change nothing, but no real import has shown it. A cut
  that keeps the end of such a Recording settles that and the frame count.
- How Premiere imports a Recording whose video starts behind an empty edit of under half a frame — ffmpeg's remux
  writes a two-entry edit list, which no Recording SmartTrim accepted before had: without an edit-list error, with the
  same frame count, and with frame n where it should be. An export of the millisecond-late file `probeRecording.test.ts`
  makes, or of the user's own Recording, imported into Premiere, settles it.
- Whether the NVIDIA App's wander stays bounded over hours. At −7.75 ms an hour, a Recording of a little over an hour
  would miss by half a frame and be refused; the user's 78-minute one missed by 1.7 ms, but its recorder is not known.
  Nor was the jitter measured at 30 or 120 fps; at 120 fps half a frame is 4.2 ms, about twice the jitter at 60.
- The two users' own files. The first one's streams all start at 0 — 1.2.0 checked the starts before the count — and
  its count now passes. The second one's audio starts and frame count were never reached; if it is still refused by a
  start, its reason says how far and in which time base.

## Consequences

`probeRecording` runs `ffprobe -v error -print_format json -show_streams`, the same arguments that captured `fixtures/ffprobe/`, and hands the output to `recordingInfoFromProbe`. ffprobe reads the stream descriptions without reading through the Recording. Output past a 64 MB buffer makes it fail rather than truncate. The ffprobe path is passed in, because where `vendor/` lands after its first-run download is not settled.

`SourceTrackInfo.durationFrames` is Premiere's count, not a measurement of the audio: SourceTrack 1 can claim a frame or two the file does not hold. Anything that needs the real audio length, such as decoding or speech detection, must take it from the decoded samples. Because SourceTrack 1 never ends before the video, the export never refuses a KeepSegment on its account.
