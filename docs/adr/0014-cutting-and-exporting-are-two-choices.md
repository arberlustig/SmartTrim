# Which SourceTracks are cut by and which are exported are two separate choices

Each SourceTrack row in the window carries two ticks: the left one puts the SourceTrack among those whose loudness
decides what is kept, the right one puts it into the Premiere sequence. Every SourceTrack of a freshly chosen
Recording starts exported; nothing is left out unless the user says so.

The owner proposed either this or a single tick that does both. A single tick cannot work: the microphone decides the
cut, but the sequence needs the game audio too. Ticking only the microphone would then hand the user a Premiere
project with nothing but the microphone in it — a silent gameplay video, discovered in Premiere rather than here.

What the second tick buys: the owner's Recordings carry the same mixdown on SourceTracks 1, 5 and 6, so exporting one
of them instead of three turns twelve TimelineTracks into two and shrinks a 50 MB XML accordingly.

## Leaving a SourceTrack out does not renumber the Channels of the others

Two numbers in the XML look alike and are not:

- `<link><trackindex>` numbers the **sequence's** TimelineTracks. Exporting two of six SourceTracks makes four audio
  TimelineTracks, numbered 1 to 4, and every link points inside that range.
- `<sourcetrack><trackindex>` names a **Channel of the Recording**, counted across all its SourceTracks — 1, 2 | 3,
  4 | … (ADR-0008). It says which Channel of the file a clip plays, so the SourceTracks that are *not* exported still
  count: exporting SourceTracks 1 and 5 writes Channels 1, 2, 9 and 10, not 1, 2, 3 and 4.

Renumbering them densely would play a different SourceTrack's audio — the same class of mistake that made the
predecessor import everything as mono, and that ADR-0008 had to fix once already. `<file>` keeps describing the whole
Recording, all six `<audio>` blocks of it, because that is where Premiere reads which Channels the file holds.

**No fixture and no import covers a partial export.** Premiere's own exports in `fixtures/premiere/` always contain
every SourceTrack, so the rule above is reasoned from ADR-0008's measurement, not measured itself. It needs a real
Premiere import before anyone relies on it — see the note in CLAUDE.md: where a fixture and a real import disagree,
the import wins.

## Consequences

An empty export choice is refused: a sequence with no audio at all looks like an edit whose sound was lost. The
window disables saving and says so instead.

A SourceTrack that is not exported no longer has to be stereo, so a mono placeholder track — which OBS writes without
being asked — can be excluded instead of blocking the whole export.

Changing an export tick does not invalidate a finished cut: it changes the file, never the CutPlan, so the result
stays on screen and only the save writes something different. The cutting ticks do invalidate it.

EmptyTracks stay exported by default even while the window hides them (ADR-0013), so a SourceTrack the scan misjudged
never loses its audio without the user choosing that.
