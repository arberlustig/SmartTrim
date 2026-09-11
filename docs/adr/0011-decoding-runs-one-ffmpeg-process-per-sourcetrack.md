# Decoding runs one ffmpeg process per SourceTrack

`decodeSourceTracks` decodes the SourceTracks it is asked for to 16 kHz mono 16-bit PCM in memory (ADR-0004), one ffmpeg process per SourceTrack, all running at once, and returns them in the order asked for. ffmpeg's error output is kept whole and becomes the error message when a process fails; output that ends in the middle of a sample is refused.

This builds only half of ADR-0005. The time-slice strategy for finely interleaved Recordings does not exist, because the measurements below neither call for it yet nor show a lossless way to cut the slices.

## Measured on 2026-09-11

`bench/decode_speed.ts` on the owner's machine (12 logical CPUs, 64 GB):

| Recording | Interleaving | SourceTracks | Drive | Time | Peak memory |
|---|---|---|---|---|---|
| long-recording.mp4, 21.9 GB, 2.5 h | coarse: a 7.6 MB video block every 3.2 s | all 6 | internal NVMe | 23.7 s | 3.8 GB |
| Part3.mp4, 9.57 GB, 2.2 h | fine: about 1.3 video packets between audio packets | 1 and 2 | slow external | 43.0 s | 1.3 GB |

Interleaving was read from ffprobe packet positions (`-show_entries packet=stream_index,pos,size`). `-of csv` prints those fields in ffprobe's own order, stream_index, size, pos, whatever order they are named in.

On Part3, two per-SourceTrack processes took 43.0 s, where ADR-0005 recorded 60.3 s for one process decoding the same two SourceTracks from the same drive. Each process does read nearly the whole file, as ADR-0005 predicted, and together they were still faster. Whether parts of the file were already in the operating system's cache is not known.

Peak memory is about twice the PCM, which for the long Recording's six SourceTracks is 1.67 GB: each SourceTrack's output is collected in chunks and then copied into one array. Preallocating from the probed length would roughly halve that. It is not done, since 64 GB leaves ample room and ADR-0004's memory ceiling only matters beyond six hours.

## Why there are no time slices

Decoding the long Recording's SourceTrack 1 as two 10-second slices (`-ss 0 -t 10` and `-ss 10 -t 10`) produced exactly as many samples as 20 seconds decoded in one piece, but not the same samples. The first slice matched bit for bit; the second differed across much of its length, by up to 2343 on a scale of 32767. The pattern suggests a small time shift rather than a click at the seam; the cause was not investigated. Slices joined that way are not the Recording's audio.

A time-slice strategy therefore needs a way of cutting that is shown to be sample-identical to one-piece decoding, and a Recording on which per-SourceTrack processes are measurably too slow, before it is worth building.

## Consequences

- Which SourceTracks to decode is the caller's choice. ADR-0004 decodes only non-empty SourceTracks, but EmptyTrack detection does not exist yet.
- ffmpeg can exit successfully after reporting damaged packets on stderr. Such messages are discarded today; whether they should reach the user is open.
- The decoded PCM goes straight into speech detection (ADR-0010).
