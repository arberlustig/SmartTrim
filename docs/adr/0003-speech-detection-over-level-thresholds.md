# Cutting decisions: speech detection measured against a loudness threshold

Every comparable tool decides what to remove with a decibel threshold. For gaming recordings that is the wrong question: game audio is almost never quiet, so a level threshold either removes nothing or removes speech along with everything else. SmartTrim instead runs voice activity detection (Silero VAD, a 2.3 MB ONNX model, roughly 800× realtime on CPU) over Voice tracks and asks whether someone is *speaking*.

Content tracks are judged the same way in spirit: a ContentEvent is a departure from that track's own recent baseline, never an absolute level. Steady background music is not content.

## Consequences

An earlier draft of this model treated Content tracks as "keep while loud". Walking through a concrete case killed it: during gaming the music runs continuously, so nothing would ever be removed — the same trap already identified for reaction videos. Relative detection is what makes the Gaming preset actually cut.

Because relative detection is the riskier half, every Preset carries a switch that drops Content tracks to Ignored, leaving the Voice track alone in charge. That is the fallback if event detection disappoints on real material.

SmartTrim's own implementation in Node measured about 130× realtime, not 800×; ADR-0010 has the measurement and the rules speech detection follows.

## Measured against a loudness threshold on 2026-09-12

The owner asked whether a plain loudness threshold, the way QuietCut and auto-editor decide, would not remove more and be simpler. `bench/level_vs_voice.ts` ran both on long-recording.mp4's microphone SourceTrack (151.9 min, its levels: quietest tenth below -56 dBFS, middle -39 dBFS, loudest tenth above -27 dBFS), through the same post-processing and the same planCuts settings, so the detector was the only difference:

| Decided by | Kept | Removed | Speech cut away |
|---|---|---|---|
| Silero speech detection | 104.3 min | 31 % | 0.0 min |
| level above -50 dBFS | 128.8 min | 15 % | 0.6 min |
| level above -45 dBFS | 113.4 min | 25 % | 2.9 min |
| level above -40 dBFS | 95.3 min | 37 % | 9.7 min |
| level above -35 dBFS | 73.5 min | 52 % | 26.3 min |
| level above -30 dBFS | 41.3 min | 73 % | 57.3 min |

"Speech cut away" is how much of the speech Silero found falls outside what the plan keeps. Every threshold that removes as much as speech detection does, or less, already throws speech away, and removing more means cutting minutes of real talking: the microphone's own middle level is -39 dBFS, so a threshold that removes appreciably more sits inside the voice's own range.

A threshold therefore does not beat speech detection; it looks stronger only because it also cuts words. The ceiling is the Recording itself: the owner speaks for 97.7 of those 151.9 minutes, so roughly a third is all there is to remove.

## The owner picked the threshold anyway

Listening decided it, not the table. The owner imported both cuts and found the -40 dBFS one "viel viel besser", although it drops 9.7 minutes that Silero calls speech. That number is a proxy, not a verdict: much of what Silero marks on this microphone is quiet bleed, breathing and half-swallowed words, and the owner does not miss them.

SmartTrim therefore offers both, and `analyseRecording` takes a `decideBy`: the voice, or a loudness threshold in dBFS. The threshold is what the owner uses, with -40 dBFS, a Margin of 0.05 s and a MinimumDeadZone of 0.25 s. Speech detection stays for Recordings where game audio bleeds into the microphone, where a threshold cannot tell the two apart, and for anyone whose words matter more than the minutes saved.

Nothing measured above is undone by the choice: the table still says what a threshold costs. It is the user's call to pay it, and the app has to make that cost visible rather than hide it.
