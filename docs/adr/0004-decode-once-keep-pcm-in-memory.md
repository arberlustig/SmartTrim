# Decode the Recording once and keep the PCM in memory

SmartTrim reads a Recording exactly once, decoding every non-empty SourceTrack to 16 kHz mono PCM, and keeps that PCM in memory for the rest of the session. Six hours of two SourceTracks is roughly 1.4 GB — affordable on a video editing machine, and it means changing a threshold recomputes the CutPlan from memory instead of touching the file again.

This is the feature no competitor has. QuietCut, auto-editor and SmartTrim's own predecessor all re-read the Recording whenever a setting changes.

## Consequences

The predecessor ran a full ffmpeg pass **per SourceTrack** and then wrote every track out as full-length uncompressed WAV — about 1.4 GB of temporary files for a two-hour Recording. Both are forbidden here: one read, no intermediate audio files on disk.

Memory is not unbounded. Very long Recordings with many populated SourceTracks need a ceiling and a spill strategy; this is unsolved and only matters well beyond six hours.
