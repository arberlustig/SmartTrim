# Decode the Recording once and keep the PCM in memory

SmartTrim reads a Recording exactly once, decoding every non-empty SourceTrack to 16 kHz mono PCM, and keeps that PCM in memory for the rest of the session. Six hours of two SourceTracks is roughly 1.4 GB — affordable on a video editing machine, and it means changing a threshold recomputes the CutPlan from memory instead of touching the file again.

This is the feature no competitor has. QuietCut, auto-editor and SmartTrim's own predecessor all re-read the Recording whenever a setting changes.

## What that buys, measured in the app

The main process keeps the decoded audio of the finished cut, and the window asks for one of three jobs depending on
what the user moved (`redoNeeded` in `src/app/cutSession.ts`):

| the user moves | the job | what it costs |
| --- | --- | --- |
| Margin or MinimumDeadZone | `replan`: plan the cuts again around what was found | **2 ms** |
| the loudness threshold | `redecide`: measure the loudness again from the audio in memory, then plan | **under 50 ms** |
| which SourceTracks are listened to | `analyse`: read the Recording | seconds to minutes |

Measured on 2026-09-12 through the running app, on a real 25-minute OBS Recording listening to one SourceTrack: the
first cut took 2.5 s, and every threshold or slider change after it came back in well under a tenth of a second.
Holding that SourceTrack's audio cost 116 MB of the process's memory (316 MB → 432 MB), which is the expected 48 MB
of 16 kHz mono PCM plus what the plan and the summaries take.

Both shortcuts are tested against the expensive path rather than against themselves: `replanCut` and `redecideCut`
have to produce exactly the CutPlan and CutSummary that reading the Recording again produces, on a real file.

## Consequences

The predecessor ran a full ffmpeg pass **per SourceTrack** and then wrote every track out as full-length uncompressed WAV — about 1.4 GB of temporary files for a two-hour Recording. Both are forbidden here: one read, no intermediate audio files on disk.

Memory is not unbounded. Very long Recordings with many populated SourceTracks need a ceiling and a spill strategy; this is unsolved and only matters well beyond six hours. The audio of the previous cut is dropped as soon as the next one replaces it.

The voice decision cannot be repeated from memory the way loudness can: `redecideCut` only re-measures loudness, because Silero would have to run again (about 70 s per SourceTrack for a 2.5-hour Recording) and the window does not offer the voice decision anyway (ADR-0003). Moving a threshold is instant; switching the kind of decision would not be.

## Amended by ADR-0021

The decoded PCM is no longer what is kept. Every later decision reads only each SourceTrack's chunk levels, so
those and its waveform are kept instead, and the audio is let go once they exist — 17.2 MB held for six
SourceTracks of a 2.5-hour Recording instead of 1,668 MB. The promise above stands: changing a setting still
recomputes from memory.
