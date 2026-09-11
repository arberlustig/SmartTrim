# Speech detection follows Silero's reference post-processing

`detectSpeech` scores 16 kHz mono PCM with Silero VAD v5 (`vendor/silero_vad.onnx`) through onnxruntime-node, and `speechRanges` turns the per-chunk probabilities into speech TimeRanges. The rules and values are those of Silero's own `get_speech_timestamps`, not thresholds of SmartTrim's choosing:

- a 512-sample chunk (32 ms) scoring 0.5 or more starts speech;
- only a chunk below 0.35 (0.5 − 0.15) begins a pause; chunks in between change nothing;
- speech ends where the pause began, once a later chunk below 0.35 lies at least 100 ms after it; a chunk scoring 0.5 or more cancels the pause;
- speech is kept only when strictly longer than 250 ms;
- speech still open when the audio ends runs to the end, even during a pause too short to end it.

Every chunk gets the previous chunk's last 64 samples in front of it (CLAUDE.md), and the model's state is carried from chunk to chunk. The final partial chunk is padded with silence, as in the reference.

## Left out of the reference

- **Padding** (`speech_pad_ms`, 30 ms). planCuts keeps Margin around speech, which does the same job at a size the Preset chooses.
- **Splitting long speech** (`max_speech_duration_s`). Its default is unlimited, and a long monologue is exactly what should be kept.
- **The exact end of the audio.** Speech open at the end closes on a whole chunk, up to 31 ms past the audio; planCuts clamps every KeepSegment to the Recording.

## Tested with synthesized speech

`fixtures/speech/` holds 12 s of Windows' built-in voice "Microsoft Hedda Desktop" between digital silence and pink noise, built by `bench/make_speech_fixture.ts`. The repository has a public remote, so no real person's voice belongs in it. Where the voice lies is measured from the synthesized audio's own level, never by a detector.

Silero found exactly the two phrases. Starts came within 31 ms of the voice; ends came about 70 ms after it, because the model's score decays over a few chunks. The test allows 0.15 s on each edge. Silence scored at most 0.009 and the pink noise at most 0.113.

## Measured on 2026-09-11

`bench/vad_speed.ts` on four 15-minute pieces of long-recording.mp4, decoded to 16 kHz mono, in Node on the owner's machine:

| SourceTrack | time | speed | speech |
|---|---|---|---|
| 1 | 7.0 s | 128× realtime | 62.2 % |
| 3 | 6.5 s | 139× realtime | 0.3 % |
| 5 | 6.8 s | 133× realtime | 62.9 % |
| 6 | 6.4 s | 140× realtime | 62.9 % |

About 130× realtime is far below the roughly 800× that ADR-0003 cites. A 2.5-hour Voice track takes a little over a minute. The gap has not been investigated; one asynchronous call into onnxruntime per 32 ms chunk is the obvious suspect. Batching SourceTracks into one call or spreading them over worker threads would need a measurement before either is built.

## Consequences

- onnxruntime-node is SmartTrim's first runtime dependency. npm blocked its postinstall script because it is not covered by `allowScripts`; the Windows binaries ship inside the package and load without it. Check this again when packaging with Electron and on any other platform.
- Audio at any rate other than 16 kHz is refused, since chunk and context sizes are Silero's values for 16 kHz.
- `detectSpeech` returns ranges only and keeps no probabilities. The thresholds above are fixed, so settings that change later, such as Margin or MinimumDeadZone, recompute the CutPlan from these ranges without running the model again.
