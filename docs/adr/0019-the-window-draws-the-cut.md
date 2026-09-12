# The window draws the cut: a strip over the whole Recording and a waveform per SourceTrack

The window shows what the cut looks like instead of only saying how many minutes it removes: a thin strip over the
whole Recording — brightness is how much of that column survives — and under it one zoomable waveform per
SourceTrack that has a role, with the kept stretches green and the removed ones dark red.

The owner asked for a "Cut Heatmap" and pointed at QuietCut, whose picture is a waveform with green and red bands
over it, not a heat strip. Both are here: the strip answers "where is much removed" at a glance, the zoom answers
"and does that sound right".

## The CutPlan still stays in the main process; its kept ranges do not

ADR-0012 keeps the CutPlan in the main process and lets only the CutSummary cross to the window. The colours are
drawn from the plan, so `CutSummary` now carries `keptRanges` — the kept stretches in seconds — and the plan itself
still never crosses.

Seconds, not frames: the window would otherwise have to do frame-rate arithmetic to line the colours up with the
waveform and the zoom, which are both in seconds. The owner's worst case is 2078 KeepSegments, about 33 KB of JSON
per slider move, next to a replan that already takes under 50 ms.

## Four things were worth testing, and the canvas was not

Agreed with the owner before any test was written:

- `peakEnvelope` — decoded audio to one height per slice of time. Each slice reports its **loudest** sample, not its
  average, so a gunshot lasting a hundredth of a second keeps its full height.
- `keptShareByColumn` — the strip. One column of a 2.5-hour Recording is minutes wide and holds dozens of cuts, so
  it reports the *share* that survives rather than kept-or-removed, and the window draws that as brightness.
- `bandsIn` — the coloured bands across the zoom window, clipped to it and covering it with no gaps.
- `zoomedTo` / `pannedBy` — zooming keeps the middle of the window in the middle, and neither zooming nor sliding
  can carry the window off the Recording.

The drawing itself and the mouse are untested, as all of the window is (ADR-0012).

## Numbers chosen here

**20 peaks a second.** A peak every 50 ms: two peaks per pixel at the closest zoom, and 182 000 numbers over a
2.5-hour Recording — 728 KB, sent once per analysis. The shape of the sound does not change when a slider moves,
only the colours over it do, so `cut:waveforms` is asked for once and the colours ride along with every summary.

**Ten seconds is the closest zoom.** About eighty pixels a second; closer than that the picture says nothing new.

**`keptShareByColumn` returns plain numbers, not a `Float32Array`.** The strip is a few hundred columns wide and is
computed inside the window, so the narrower type buys nothing — and it rounded a column that is four tenths kept to
0.40000000596.

## Only SourceTracks with a role get a waveform

The owner's rule: "Es gibt nur für Spuren eine Wellenform wenn man sie schneiden möchte." A SourceTrack set to
*wird ignoriert* was never decoded, so drawing it would mean reading the whole Recording again for it. What is on
screen is what SmartTrim actually listened to; nothing drawn is guessed.

To check whether SourceTrack 3 carries the game, give it a role and cut once.

## A reopened project reads its audio again, in the background

A `.smarttrim` project holds what the analysis found, never the audio (ADR-0016), so a reopened project has no
waveform. The owner chose to read it again rather than live without one: reopening is exactly when you want to
check yesterday's cut by eye and ear.

`project:readAudio` decodes the SourceTracks the project names while the window is already usable. When it lands,
the audio is back in memory, so moving the threshold decides again instead of demanding a whole new cut.

## Two mistakes worth remembering

`draw()` did not call `drawWaveforms()` for a while: the edit that was supposed to add it silently matched nothing,
and the check for it grepped a string that already existed in another function. The numbers updated on every slider
and the picture stood still. **Confirm an edit by reading the function it belongs to, not by grepping for a string
that lives elsewhere too.**

Dragging the waveform used `setPointerCapture`, and when that throws the drag died without a sound. The move and
release listeners now sit on the window, so a drag survives both a refused capture and a pointer that wanders off
the canvas.
