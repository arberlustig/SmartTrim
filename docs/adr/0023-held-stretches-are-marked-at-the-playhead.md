# Held stretches are marked at the Playhead, with an Anfang and an Ende

A LockedRange (CONTEXT.md) is marked in the window with two buttons: "Anfang festhalten" puts its start at the
Playhead, "Ende festhalten" puts its end there. The stretch in between is kept whatever the sliders say, with exact
edges and no Margin, and shows as a blue band over every waveform and in the OverviewStrip. A list under the
waveforms names every held stretch with an "entfernen" beside it. Held stretches are saved in the TrimProject, not
in Presets.

The owner asked for it once playback existed: listening, they would find moments the cut removes that should stay.
The design was proposed and accepted on 2026-09-13 ("Passt so, bau es").

## Why two buttons at the Playhead

- **It fits listening.** The Playhead already marks the moment being heard (ADR-0022). Pressing Anfang when a
  moment starts and Ende when it is over needs no second gesture on the waveform, where a drag already pans the
  view and a click already moves the Playhead.
- **The order does not matter.** Clicking back to where a moment began puts the Ende before the Anfang; the same
  stretch is meant, so the two are sorted rather than refused.
- **Refused:** an Ende with no Anfang waiting, an Anfang and Ende at the same moment (a stretch that keeps no frame),
  and any mark while no Recording is chosen.

## One list, in order, without doubles

Held stretches that overlap or touch are joined into one, and the list stays in the order of the Recording. Two
entries for one held stretch would leave it held after one of them was removed.

Choosing another Recording lets go of every held stretch and of a waiting Anfang: a moment in one Recording says
nothing about the next.

## Not in Presets

A Preset describes a kind of video (ADR-0017); a held stretch is a moment in one Recording. It travels with the
TrimProject instead.

## Holding costs a replan, never a read

Held stretches are planned around what the analysis already found, exactly like a Margin, so `redoNeeded` answers
"replan" when they change: milliseconds, and the Recording is not touched (ADR-0004). A waiting Anfang holds nothing
and owes nothing.

## Shape

- `CutSession.lockedRanges` and `CutSession.lockedRangeStart`; `markLockedRangeStart`, `markLockedRangeEnd`,
  `removeLockedRange` in `src/app/cutSession.ts`. `PlannedWith` remembers the held stretches a plan was made with.
- `planSettingsFrom`, `analysisRequestFrom` and `savedChoicesFrom` name `lockedRanges` only when there are any: an
  absent list means none, as it does for every caller and every file written before them.
- `analyseRecording` and `replanCut` hand them to `planCuts`, which already kept a LockedRange with exact edges.
- TrimProject format 3 adds `lockedRanges`; files of format 1 and 2 open with none. `openTrimProject` replans with
  them, and `projectOpened` puts back exactly the project's own, dropping whatever the session before held.
- Window: "Anfang festhalten" / "Ende festhalten" and the list sit under the waveforms (`#held`), shown whenever the
  waveforms are. They mark `playheadNow()`: the moment being heard while a SourceTrack plays, else the Playhead.
  `drawHeldOver` tints each held stretch blue with an edge near the top, on every waveform and in the OverviewStrip,
  and draws a waiting Anfang as a thin line. The pending-replan check in `redoNow` now compares every setting a plan
  is made with, not only threshold, Margin and MinimumDeadZone, so a stretch held while a replan ran is not lost.

## Tested, and not

- `src/app/lockedRanges.test.ts`: an Anfang and an Ende make one stretch, in either order; an Ende without Anfang, a
  stretch of no length and a mark without a Recording are refused; overlapping and touching stretches join and stay
  in order; another Recording lets go of them; removing one leaves the others; holding or letting go is a replan the
  settings carry; saving hands them on and reopening puts back exactly the project's own.
- `runCut.test.ts`, on a generated Recording: a held second of the closing silence is kept to the frame (315..345 at
  30 fps, where a Margin would have made it 313..347), and replanning with it equals a cut that reads the Recording
  again.
- `trimProject.test.ts` and `openTrimProject.test.ts`: held stretches survive the file, and a reopened project keeps
  the held second in its plan.
- The buttons, the list and the blue bands are drawing, untested like the rest of the window (ADR-0012). They were
  checked in the browser pane with a fake bridge: the check found that clicking a waveform did not refresh the hold
  buttons, so "Anfang festhalten" stayed disabled after the Playhead was placed. `placePlayhead` now redraws them.
