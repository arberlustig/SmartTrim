# A ContentEvent is a departure from the SourceTrack's own recent baseline

`src/level/detectContentEvents.ts` judges every 32 ms chunk of a Content SourceTrack against the **median level of
the window that ends just before it** — five seconds by default. A chunk that rises 12 dB above that baseline, or
falls 15 dB below it, is departing; a run of such chunks lasting at least 0.1 s is a ContentEvent.

Three properties come out of that shape, and all three are the point:

- **Continuous background audio is never an event, however loud** (CONTEXT.md). A game that roars from end to end
  raises its own baseline, so nothing departs from it. Measured: a synthetic 20-second stretch at -12 dBFS yields
  zero events.
- **One bang does not become the new normal.** The baseline is a median, not an average, so a single loud chunk
  cannot drag it. A minute of banging does move it — which is correct: by then it is the background.
- **A level that jumps and stays is an event only until the baseline catches up**, about half the window. Music
  starting is a moment; music playing is not.

Nothing is judged in the first window of a Recording: there is no recent past to compare it against yet.

## Measured on a real Recording

`bench/content_events.ts` on the owner's 25-minute OBS capture, SourceTrack 3 (the one that carries sound only now
and then): **155 events covering 3.6 min, 14.2 % of the SourceTrack, found in 0.1 s** — so about 0.6 s for a
2.5-hour Recording, cheap enough to run inside every analysis.

The defaults sit in a flat part of the curve, which is why they are the defaults: raising the rise from 12 dB to
18 dB changes 155 events into 137 (14.2 % → 13.3 %), while stretching the baseline from 5 s to 15 s raises coverage
to 20.1 %. The material has sharp, well-separated moments; the exact threshold hardly matters.

On SourceTrack 5 — the mixdown that carries the owner's voice — the same settings find **1014 events**, because
every phrase onset jumps out of the pause before it. That is the measurement that says what a Content SourceTrack is
for: a track carrying speech belongs in the Voice role, where speech is what is being looked for.

## What is judgement and not measurement

- `riseDb` 12, `dropDb` 15, `baselineSeconds` 5, `minimumEventSeconds` 0.1 are reasoned and checked for stability,
  not chosen by ear. Nobody has listened to a cut built from them.
- EventLead 1.5 s and EventTail 2 s are a guess at what a bang needs around it to read as one.
- Of the three Presets, only **Gaming** is measured: it holds the settings the owner arrived at by listening
  (ADR-0003). **Reaction** and **Podcast** are a starting point.

The owner's own Recordings put voice and game audio on the same SourceTrack, so all of this is built for a setup
they do not use yet — a separate OBS track for the microphone. They asked for it anyway, and it is better to have
the mechanism measured and the numbers written down than to guess later.

## A Preset holds thresholds, not TrackRoles

CONTEXT.md called a Preset "a named set of TrackRoles and thresholds". The TrackRoles are not in it: which
SourceTrack carries the microphone depends on the Recording's OBS setup, not on the kind of video, and SourceTrack 5
of one capture is not SourceTrack 5 of the next. A Preset therefore sets the five thresholds and leaves every role
alone, and the window shows "eigene" as soon as a slider is moved off one.

## Consequences

A Content SourceTrack is decoded in the same ffmpeg pass as the Voice SourceTracks — the Recording is still read
once (ADR-0004). Its moments live in the CutResult and in the TrimProject (format 2), so they survive a replan and a
reopen without being looked for again; only adding or removing a Content SourceTrack costs a new read.

EventLead and EventTail take the place of the Margin around a ContentEvent, so they are planning settings: moving
those two sliders replans in milliseconds.
