# A TrimProject saves what the analysis found, not the CutPlan and not the audio

A `.smarttrim` file is JSON holding the Recording as it was probed, what the user ticked, the settings, and the
stretches the analysis found worth keeping. Reopening it probes the Recording — stream descriptions only — and plans
the cuts again from those stretches, which takes about two milliseconds (ADR-0004).

Two things are deliberately **not** in the file.

- **The CutPlan.** It follows from the stretches plus Margin and MinimumDeadZone, and `planCuts` is deterministic
  and tested. Saving it as well would mean two sources of truth that a hand-edited or half-written file could put at
  odds, for no gain over recomputing it.
- **The decoded audio.** Hundreds of megabytes, and only a new threshold would need it. So after reopening, moving
  Margin or MinimumDeadZone is still free, while moving the threshold reads the Recording again — the window knows
  the difference through `audioInMemory` in the session and says "noch einmal schneiden".

## The Recording has to be the one it was cut from

Every position in a CutPlan is a frame of one particular file. Against a re-exported or trimmed Recording those
positions point somewhere else, or past its end, and Premiere would import an edit that is quietly wrong. So opening
compares the timing — frame rate, length in frames, and each SourceTrack's length — and refuses when it differs,
naming both. Anything else may differ: the export takes resolution and the rest from the Recording as it is now, so
a file that was only re-encoded at another size still opens.

A Recording that has moved away is refused with ffprobe's own message, which names the path it was looked for at.

## The format number

The file starts with `"smarttrim": 1`. A file from a newer SmartTrim is refused rather than half read: saving it
again would silently drop whatever this version cannot see. A file without that number is not ours.
`fixtures/trimproject/version-1.smarttrim` is a hand-written format 1 file, checked in, with a test that it still
opens — so a later change to the reader cannot quietly stop reading the files the owner already has.

JSON has no `-Infinity`, so a silent SourceTrack's peak level goes out as `null` and is read back as silence.
Without that, a reopened project would read "peak 0 dBFS" off a SourceTrack that holds nothing.

## Consequences

Saving is offered only while the numbers on screen match the settings behind them, which after a slider move is a
matter of milliseconds. The file also remembers the export ticks, which had no say in the plan (ADR-0014), so
reopening restores the whole window and not just the cut.

`TrackRole` and `Preset` do not exist yet; when they do, they belong in this file and the format number goes to 2.
