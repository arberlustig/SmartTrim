# The window draws the cut: a strip over the whole Recording and a waveform per SourceTrack

The window shows what the cut looks like instead of only saying how many minutes it removes: a thin strip over the
whole Recording — brightness is how much of that column survives — and **inside each SourceTrack's own row**, right
under the dropdown that gave it a role, that SourceTrack's zoomable waveform, kept stretches green and removed ones
dark red.

The waveforms first sat in a section of their own at the bottom. The owner asked for them in the rows instead
("direkt unter der jeweiligen Spur wenn man das Dropdown auf danach schneiden oder Momente behalten switcht"), and
that is plainly right: the waveform answers a question about *that* SourceTrack, so it belongs next to it. A row on
*wird ignoriert* gets none.

Because `drawSourceTracks` rebuilds every row on every draw, the canvases are **kept in a Map and reused** rather
than made anew. A fresh canvas each draw would blank the picture constantly and would drop the pointer mid-drag.
The rows are also what put a canvas on screen at all, so loading the waveforms ends in a full `draw()`, not just a
repaint — otherwise the rows stay as they were built, back when there was nothing to draw.

The owner asked for a "Cut Heatmap" and pointed at QuietCut, whose picture is a waveform with green and red bands
over it, not a heat strip. Both are here: the strip answers "where is much removed" at a glance, the zoom answers
"and does that sound right".

## The strip carries the sound as well as the cut

It first carried only the cut, and the owner found it empty before anything was cut — reasonably, since a strip
that shows a plan has nothing to show without one. It now carries both, like the waveforms below it: the cut as the
band behind, the sound as a waveform in front. The waveform is the **loudest** of the shown SourceTracks in each
column, which answers "is there any sound here at all" across a column that may be minutes wide.

It is hidden entirely when no SourceTrack has a role. What was read for a role that was taken away is kept in memory
(ADR-0020), but keeping it on screen left an empty strip claiming to show a cut.

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
  it reports the *share* that survives rather than kept-or-removed, and the window draws that as how green the
  column's band is.
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
what a threshold is decided from is back in memory — the chunk levels since ADR-0021 — so moving the threshold
decides again instead of demanding a whole new cut.

## What drawing is allowed to cost

A redraw happens on every slider `input` event, so it has to fit in a frame — 16.7 ms at 60 fps. A review found
four ways it did not, all measured on the owner's real scale (2.5 hours, 2000 KeepSegments, three waveforms, 803
columns):

- **Searching the whole cut for every pixel column.** `keptAt` scanned all 2000 kept ranges to colour one column:
  **34.5 ms per redraw for that scan alone**, before anything was painted. The bands were already computed for the
  background twenty lines above, in order and covering the window, so one cursor now walks them alongside the
  columns. `keptAt` is gone.
- **`overviewPeaks` rescanned 1.08 million peaks per redraw**, though its answer depends only on which waveforms
  are shown and how wide the strip is — neither changes when a slider moves. Cached on exactly those two.
- **`canvasBrush` reassigned `canvas.width`/`height` every time**, which throws the bitmap away and allocates a new
  one — about 3.7 MB per redraw. It only does so now when the size really changed.
- **The waveform numbers were rebuilt from the PCM on every request** (`waveformsOf` in `cut:waveforms`), walking
  144 million samples per SourceTrack. The main process now builds a SourceTrack's waveform once, when it is read,
  and hands out the kept one — since ADR-0021 beside its chunk levels, with the audio itself no longer kept.

Measured after: **8.12 ms per redraw zoomed out, 3.77 ms zoomed in** — the whole redraw, drawing included.

## Two mistakes worth remembering

`draw()` did not call `drawWaveforms()` for a while: the edit that was supposed to add it silently matched nothing,
and the check for it grepped a string that already existed in another function. The numbers updated on every slider
and the picture stood still. **Confirm an edit by reading the function it belongs to, not by grepping for a string
that lives elsewhere too.**

Dragging the waveform used `setPointerCapture`, and when that throws the drag died without a sound. The move and
release listeners now sit on the window, so a drag survives both a refused capture and a pointer that wanders off
the canvas.

The frame in the overview strip only answered to `click`, so it stayed put under the pointer and then appeared
somewhere else on release — the owner called it buggy, and it was. It is dragged now: pressing inside the frame
keeps the spot you took hold of, pressing outside centres it there at once, and it follows the pointer the whole
way instead of teleporting at the end.
