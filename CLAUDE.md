# SmartTrim

Desktop app (Electron + TypeScript) that finds the stretches of a long gaming recording where nothing worth keeping happens, and writes an Adobe Premiere Pro project containing only the rest.

**Read [CONTEXT.md](./CONTEXT.md) before writing code.** The vocabulary there is load-bearing: `SourceTrack`, `TimelineTrack` and `Channel` are three different things, and conflating them is what made every audio track import as mono in the predecessor project. Never use a bare `track` identifier.

Architecture decisions live in [docs/adr/](./docs/adr/). Read the relevant one before changing anything it covers — several record measurements that contradict the obvious approach.

## Non-negotiables

- **Never re-encode or rewrite the Recording.** The exported XML references the original file. No intermediate audio files the export depends on. See ADR-0006.
- **Read the Recording once.** Never one pass per SourceTrack. See ADR-0004.
- **Never assume frame rate, resolution, sample rate or channel layout** — always probe the Recording. Hardcoded `60` and `1920x1080` silently shifted every cut in the predecessor.
- **Never silently truncate ffmpeg output.** The predecessor capped collected stderr at 2 MB, losing cuts on long Recordings with no error shown.
- **Never report success for work that did not happen.**
- **Silero VAD needs 64 samples of preceding context prepended to every 512-sample chunk** (576 total at 16 kHz), and the previous chunk's last 64 samples carried forward. Feed it a bare 512 and it does not fail — it returns ~0.0007 for every chunk forever, which reads as "nobody ever speaks". Measured: same audio scored 0.0 % speech without context and 61 % with it.

## Export correctness

`fixtures/premiere/` holds two real exports from Premiere — ground truth for what Premiere *writes*, not for what it *reads*. Test generated XML against them. The multi-track fixture encodes the rule that matters: each stereo SourceTrack becomes **two** TimelineTracks, differing `currentExplodedTrackIndex` (0 and 1). But `sourcetrack/trackindex` must count Channels across all SourceTracks (1, 2 | 3, 4 | …), not repeat the SourceTrack number the way Premiere's own export does: that export re-imports spread over two TimelineTracks and louder on the left. A real import proved it — see ADR-0008. Where a fixture and a real import disagree, the import wins. Premiere also needs `explodedTracks`, `premiereTrackType`, `premiereChannelType`, `masterclipid` and `groupindex` on links.

Exporting only some SourceTracks is the one case no fixture and no import covers: the Channel numbers of the exported SourceTracks stay as they are in the Recording (ADR-0014), which is reasoned, not measured. An import check is still open.

Only Premiere can confirm an import truly works, and only the owner can run it. When export behaviour changes, say that a real import check is needed rather than claiming it works.

## Tooling

`vendor/` holds ffmpeg (LGPL build) and the Silero VAD model, git-ignored; they are downloaded on first run in production. `bench/` holds measurement scripts, not product code.

## Working with the owner

Conversations are in German; code, comments and docs are English. The owner does not read the source and does not want it explained — build it so the next AI session can. That means tests around the cutting logic and ADRs for anything surprising.
