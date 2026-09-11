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

- **Every SourceTrack rounded down, the first included** — matches five of the six the long Recording SourceTracks and ends SourceTrack 1 two frames before Premiere does. Never imported; the demo cut the owner imported on 2026-09-11 used Premiere's own lengths.
- **Counting samples at the end of each stream** instead of ffprobe's `duration_ts`. `duration_ts` comes from the edit list, which OBS writes in milliseconds, so in long-recording.mp4 it stops 16 samples before the last packet ends. That changes the rounded-down frame only when a SourceTrack ends within a few hundredths of a frame after a frame boundary, and reading packet timestamps means reading into the file (ADR-0004). Both Recordings give the same frames either way.

## Refused rather than guessed

- **A variable frame rate.** The video's frame count must fill its duration at `r_frame_rate` exactly, compared as fractions without tolerance; otherwise every cut would drift. Both Recordings and ffmpeg-generated test files fill it exactly. If a Recording with a truly constant frame rate is ever refused, loosen the check with that Recording in hand.
- **A value ffprobe does not report.** Matroska, for one, reports no `duration_ts` or `nb_frames` per stream, so MKV Recordings are refused until someone measures how to read their lengths.
- **Audio codecs other than AAC that report no bit depth**, such as Opus. AAC reports none either; both Premiere exports write 16 for it. Codecs with a bit depth of their own, like PCM, keep theirs.
- **Anything but exactly one video stream.** ffprobe lists a cover picture as a video stream too.
- **A stream that does not start at pts 0.** The export places every SourceTrack's clips at the same Recording frames as the video's.

## Consequences

`probeRecording` runs `ffprobe -v error -print_format json -show_streams`, the same arguments that captured `fixtures/ffprobe/`, and hands the output to `recordingInfoFromProbe`. ffprobe reads the stream descriptions without reading through the Recording. Output past a 64 MB buffer makes it fail rather than truncate. The ffprobe path is passed in, because where `vendor/` lands after its first-run download is not settled.

`SourceTrackInfo.durationFrames` is Premiere's count, not a measurement of the audio: SourceTrack 1 can claim a frame or two the file does not hold. Anything that needs the real audio length, such as decoding or speech detection, must take it from the decoded samples. Because SourceTrack 1 never ends before the video, the export never refuses a KeepSegment on its account.
