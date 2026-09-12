# EmptyTracks are found by sampling slices, and a sample is never treated as proof

OBS writes six SourceTracks whether or not anything was routed to them, so the window would otherwise ask the user to
pick the microphone out of six identically named tracks, most of which hold nothing. `src/scan/scanSourceTracks.ts`
measures a few short slices of every SourceTrack and hides the ones that carried nothing (CONTEXT.md: EmptyTrack).

## How the levels are measured

One ffmpeg process per slice, with one `astats` filter per SourceTrack, `-ss` before `-i` so ffmpeg seeks instead of
decoding up to the slice, and `-f null -` so nothing is written. The whole file is read once per slice, for every
SourceTrack at once. On a real 25-minute OBS Recording with six stereo SourceTracks on an NVMe drive, five slices of
ten seconds took **0.7 s** — cheap enough to run every time a Recording is chosen.

`astats` reports through the filter graph, and **ffmpeg prints the blocks in whatever order the filters finish**: that
Recording reported SourceTrack 1, then 6, 5, 4, 3, 2. The SourceTrack a block belongs to is therefore read from the
filter name `Parsed_astats_<position>`, never from the order of the output. Reading them in order would have handed
SourceTrack 2's silence to SourceTrack 6 and hidden a track the owner speaks on.
`fixtures/astats/obs-6-sourcetracks-slice.txt` is that real output, its path replaced because the repo is public.

## Why five slices and not one

Measured on the same Recording: SourceTrack 4 was silent in every slice, while SourceTrack 2 was silent in three
slices out of five and peaked at -13 dBFS in the other two, and SourceTrack 3 carried sound in four out of five. A
single slice would have called SourceTrack 2 empty. A SourceTrack counts as empty only when **no** slice found
anything above -70 dBFS, and the window says "Ton durchgehend" or "Ton stellenweise" so the difference stays visible.

## A sample cannot prove a SourceTrack is empty

Five slices of ten seconds are 3 % of a 25-minute Recording and under 1 % of a 2.5-hour one. A SourceTrack that only
makes a sound between the slices looks empty. Two things follow, and neither may be removed:

- the window offers "N leere Tonspuren trotzdem zeigen", so a hidden SourceTrack is always reachable and can still be
  ticked;
- the export writes every SourceTrack regardless (ADR-0008), so a SourceTrack misjudged as empty never loses its
  audio in Premiere.

A missing measurement is refused rather than read as silence: if ffmpeg reports no level for a SourceTrack,
`sourceTrackLevelsFromAstats` throws instead of returning -Infinity, because silence and "we did not hear" mean
opposite things here.

## Consequences

The scan says whether a SourceTrack carries sound, not what it carries. On the owner's Recordings SourceTracks 1, 5
and 6 hold near-identical levels — the mixdown and the two duplicated mixes — so the scan cannot point at the
microphone, and the user still ticks. Telling voice from game audio would need speech detection per SourceTrack,
which is possible on slices but was not built.
