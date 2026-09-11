# Decode strategy is chosen from the Recording's interleaving

ffmpeg decodes multiple audio streams of one input sequentially, so a single process is the slowest option whenever a Recording has several populated SourceTracks. SmartTrim parallelises instead, and picks *how* by inspecting the Recording's interleaving before decoding.

- **Coarse interleaving** (large video chunks): one ffmpeg process per SourceTrack. Each process seeks past the video and reads only its own audio, so the extra passes cost almost nothing.
- **Fine interleaving** (audio interleaved every few milliseconds): one process per **time slice**, each decoding all SourceTracks within its slice. Splitting by track here would make every process read nearly the whole file.

## Consequences

Measured on the owner's machine, all from the same slow external drive:

| Case | Time |
|---|---|
| 9.57 GB, fine interleaving, 2 tracks, one process | 60.3 s |
| 21.9 GB, coarse interleaving, 4 tracks, one process | 47.1 s |
| 21.9 GB, coarse, **1** track, one process | 9.1 s |
| 21.9 GB, coarse, 4 tracks, **4 parallel processes** | 19.1 s |
| same file from the internal NVMe, 4 parallel processes | 13.5 s |

Interleaving matters more than file size: the 21.9 GB Recording beat the 9.57 GB one. One process per track is worth roughly 2.5×.

Only the per-SourceTrack strategy is built so far. On the finely interleaved 9.57 GB Recording above, two per-SourceTrack processes later took 43.0 s against these 60.3 s, and cutting time slices with `-ss`/`-t` did not reproduce one-piece decoding sample for sample. ADR-0011 has the measurements.

## Considered Options

**A custom MP4 demuxer** reading only the audio byte ranges from the sample table was measured and rejected. `ffmpeg -vn` already seeks past video data, and on finely interleaved Recordings the ~1 million tiny reads such a demuxer would issue are about four times *slower* than the plain sequential path on the target hardware. Do not revive this without new measurements.
