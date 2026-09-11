# The export follows the Premiere fixtures, except where Premiere misreads its own export

`exportFcp7Xml` is tested against the two real Premiere exports in `fixtures/premiere/`, compared by structure rather than byte for byte: sequence name, frame rate and length, the sequence frame and timecode, every clip's positions in frames and in Premiere ticks, the file definition and its file URL, each TimelineTrack's Channel and SourceTrack reference, the audio outputs, and every link resolved to the clip it points at. Where the fixtures say nothing, the export refuses instead of guessing. The predecessor guessed, and every track imported as mono.

The fixtures are ground truth for what Premiere writes, not for what it reads. They turned out wrong about the one field that decides whether stereo survives the import. Where a fixture and a real import disagree, the import wins.

## Premiere's own export is wrong about `sourcetrack/trackindex`

Premiere writes the Channel number there for a single stereo SourceTrack (1, 2), but the SourceTrack's number for both Channels when there are six (1, 1, 2, 2, …). Its importer reads the field as a Channel number counted across all SourceTracks. Re-importing Premiere's own six-track export spreads each stereo SourceTrack across two TimelineTracks and plays louder on the left ear.

The export therefore counts Channels: 1, 2 | 3, 4 | … | 11, 12. The owner imported each variant of long-recording.mp4 into Premiere on 2026-09-11, one variable at a time:

| Variant | Premiere import |
|---|---|
| SmartTrim's export, trackindex as in the fixture | louder left, sound spread over A1 and A2 |
| the same plus Premiere's `Panner*` attributes | unchanged |
| Premiere's own export, only the file path replaced | unchanged |
| SmartTrim's export, Channels counted across SourceTracks | balanced, sound on A1 alone, as when dragging the Recording in |

auto-editor's Premiere export counts Channels the same way (`sourceTrackIndex: channelOffset + explodedIndex + 1`). For a single SourceTrack both numberings agree, which is why the single-track fixture never showed the problem. The multi-track fixture test compares everything except this field; a separate test pins the Channel numbering.

## What else the fixtures settled

- **Every SourceTrack keeps its own length.** In the multi-track fixture five SourceTracks end two frames before the video, and Premiere ends their clips there. The export needs each SourceTrack's length as Premiere counts it: the first SourceTrack as long as the video, every later one rounded down to its last whole frame, although all six are equally long in the file. ADR-0009 records the measurement.
- **Every clip of a KeepSegment links to all clips of that KeepSegment**, itself included; audio links carry `groupindex` 1, the video link carries none.

## Refused rather than guessed

- **SourceTracks that are not stereo.** The owner's decision: nothing shows how Premiere reads mono or 5.1, so they are refused until a real Premiere export of one exists and an import confirms the export.
- **Frame rates FCP7 XML cannot express.** Only whole rates and their NTSC variants (n × 1000/1001) can be written; rounding anything else would shift every cut.
- **A KeepSegment that starts after a SourceTrack has ended.** No fixture shows how Premiere links it, and writing it would produce a clip of negative length.

## Not written

Premiere's interface state (`TL.*` and `MZ.*` attributes, labels, logging and colour info), the `Panner*` attributes (adding them did not change the imported balance), the sequence `uuid`, the preview-render codec, the empty tracks a sequence preset adds, and the per-clip `alphatype`, `pixelaspectratio` and `anamorphic` copies.

All SourceTracks are exported, EmptyTracks included — the owner's decision, so a SourceTrack misjudged as empty never loses audio in Premiere.

## Assumed, not backed by a fixture

- NTSC rates are marked as timebase n with `ntsc` TRUE and a non-drop-frame timecode.
- The Recording's timecode starts at 00:00:00:00, pixels are square and the video is progressive. These are written as constants; OBS Recordings match them, but they are not probed yet.
- Names are XML-escaped. The tests check for a bare `&` explicitly, because xmldom accepts one without complaint while the XML spec and strict readers do not.

## Consequences

Passing tests mean the XML matches what Premiere writes, corrected where a real import proved Premiere reads it differently. They do not prove Premiere imports it: only a real import by the owner confirms that, and it is needed again whenever export behaviour changes.
