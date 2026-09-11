# FCP7 XML as the export format

SmartTrim exports a CutPlan as FCP7 XML (xmeml version 4), the interchange format Premiere has imported for roughly fifteen years. Premiere, DaVinci Resolve and Final Cut all read it, it needs no plugin installed on the user's machine, and it can be tested without Premiere present.

## Considered Options

- **`.prproj` directly** — gzipped XML, but the content is Premiere's private object graph with thousands of cross-referenced numeric IDs, undocumented and reshaped between versions. Pure reverse engineering.
- **`.fcpxml` (1.9+)** — Premiere does not import it directly; it would need a detour through Resolve.
- **EDL** — too poor to carry multi-track audio. **AAF** — far heavier than a cut list needs.
- **ExtendScript** — Adobe supports it only until September 2026.
- **UXP panel** — out of beta in Premiere 2026, but the API still moves, and a UXP panel cannot host a server, so SmartTrim would have to run one for the panel to connect to. Recorded as a possible later addition, not a foundation.

## Consequences

The exact XML shape is not guessed. Two real exports from the user's own Premiere are checked in under `fixtures/premiere/` and serve as the ground truth: a single-SourceTrack sequence at 30 fps, and a six-SourceTrack sequence at 60 fps.

The multi-track fixture settles the rule that broke the predecessor: each stereo SourceTrack becomes **two** TimelineTracks carrying the same `sourcetrack/trackindex` and differing in `currentExplodedTrackIndex` (0 and 1). Emitting one TimelineTrack per SourceTrack is what made every track import as mono.
