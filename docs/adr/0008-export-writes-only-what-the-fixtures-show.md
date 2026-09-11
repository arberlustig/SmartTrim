# The export writes only what the Premiere fixtures show

`exportFcp7Xml` is tested against the two real Premiere exports in `fixtures/premiere/`, compared by structure rather than byte for byte: sequence name, frame rate and length, the sequence frame and timecode, every clip's positions in frames and in Premiere ticks, the file definition and its file URL, each TimelineTrack's Channel and SourceTrack reference, the audio outputs, and every link resolved to the clip it points at. Where the fixtures say nothing, the export refuses instead of guessing. The predecessor guessed, and every track imported as mono.

## What the fixtures settled

- **`sourcetrack/trackindex` depends on the SourceTrack count.** With one stereo SourceTrack Premiere writes the Channel number (1, 2); with six it writes the SourceTrack number for both Channels (1, 1, 2, 2, …). Two to five SourceTracks are assumed to follow the six-track rule. A fixture with two SourceTracks would settle it.
- **Every SourceTrack keeps its own length.** In the multi-track fixture five SourceTracks end two frames before the video, and Premiere ends their clips there. The export needs each SourceTrack's probed length.
- **Every clip of a KeepSegment links to all clips of that KeepSegment**, itself included; audio links carry `groupindex` 1, the video link carries none.

## Refused rather than guessed

- **SourceTracks that are not stereo.** The owner's decision: no fixture shows mono or 5.1, so they are refused until a real Premiere export of one exists.
- **Frame rates FCP7 XML cannot express.** Only whole rates and their NTSC variants (n × 1000/1001) can be written; rounding anything else would shift every cut.
- **A KeepSegment that starts after a SourceTrack has ended.** No fixture shows how Premiere links it, and writing it would produce a clip of negative length.

## Not written

Premiere's interface state (`TL.*`, `MZ.*` and panner attributes, labels, logging and colour info), the sequence `uuid`, the preview-render codec, the empty tracks a sequence preset adds, and the per-clip `alphatype`, `pixelaspectratio` and `anamorphic` copies. None of them describe the edit.

All SourceTracks are exported, EmptyTracks included — the owner's decision, so a SourceTrack misjudged as empty never loses audio in Premiere.

## Assumed, not backed by a fixture

- NTSC rates are marked as timebase n with `ntsc` TRUE and a non-drop-frame timecode.
- The Recording's timecode starts at 00:00:00:00, pixels are square and the video is progressive. These are written as constants; OBS Recordings match them, but they are not probed yet.
- Names are XML-escaped. The tests check for a bare `&` explicitly, because xmldom accepts one without complaint while the XML spec and strict readers do not.

## Consequences

Passing tests mean the XML matches what Premiere itself wrote. They do not prove Premiere imports it: only a real import by the owner confirms that, and it is needed again whenever export behaviour changes.
