# Keep the chunk levels and the waveform of a SourceTrack, let its audio go

Once a SourceTrack has been read, SmartTrim keeps two things of it and nothing else: how loud each 32 ms chunk is
(`levelsDbfs`) and the heights its waveform is drawn from (`peaks`). Together they are a `ReadSourceTrack`, built by
`readSourceTrackFrom` in `src/analysis/analyseRecording.ts`. The decoded samples are let go as soon as those two
exist.

This amends ADR-0004, which kept the decoded PCM so that another threshold could be decided from memory. That
promise still holds; what is kept to keep it has changed.

## Why

ADR-0020 moved reading forward to the moment a Recording is chosen, and read every SourceTrack that carries sound.
On the owner's 2.5-hour long-recording.mp4 that meant six SourceTracks of 278 MB each — **1,668 MB held for the whole
session**. The owner asked whether that could not be leaner, having expected SmartTrim to run lightly as a matter of
course.

It could, because nothing that happens after reading needs the samples:

- a moved threshold slider runs `loudRanges`, which reads only the chunk levels;
- ContentEvents come from `contentEventsFrom`, which reads only the chunk levels;
- a replan reads neither;
- the waveform reads only the peaks.

The one consumer of samples is Silero speech detection, and the window never offers to decide by voice again from
memory (ADR-0003). `analyseRecording` handles that case honestly: deciding by voice decodes the Voice SourceTracks
again even when they were read before, because levels cannot be scored by Silero.

## Full precision, on purpose

`levelsDbfs` is a `Float64Array`, not a `Float32Array`. Float32 would halve it — 1.1 MB instead of 2.3 MB for a
2.5-hour SourceTrack — but rounds every level. A chunk a hair from the threshold could then land on the other side
than it did when it was computed, and a cut built from kept levels would silently differ from one built from a fresh
read. The levels are exactly what `chunkLevelsDbfs` computed, so both paths decide identically by construction.

Per chunk that is 8 bytes against the 1,024 bytes of its 512 samples: 128 times smaller.

## Measured

`bench/kept_memory.ts` on long-recording.mp4, all six SourceTracks, from the slow external drive:

| | |
|---|---|
| Read in | 22.2 s |
| Audio held until now | 1,668.4 MB |
| Kept now (chunk levels + waveform) | **17.2 MB** |
| After garbage collection | 5.1 MB heap, 17.4 MB array buffers |
| Peak while reading | 3,316.5 MB — **unchanged** |

The peak is ffmpeg's output being collected and copied while six SourceTracks decode side by side; it is not what
is kept, and this decision does not touch it. It could be lowered by decoding fewer SourceTracks at once, which
costs time. That has not been measured and is not done.

**Lowered since, without costing time:** each SourceTrack is now reduced the moment its own decode finishes rather
than after all of them, which brought this peak down to about 2,300 MB for six SourceTracks with the read time
unchanged (ADR-0011).

**A pitfall in measuring this.** The first version of the bench decoded in top-level module code across an `await`.
The suspended module kept the decoded audio reachable after its block had ended, and reported **2,012.8 MB after
collection** — the bench holding on to the audio, not the product. The read now happens inside a function, as it does
inside the product's IPC handler, and the collector is given a few rounds with pauses, because array buffer memory is
released behind it rather than inside it.

## Proof that no cut changed

- `runCut.test.ts` still compares a threshold decided again from what was kept against a fresh `runCut` on a real
  Recording, and it is green unchanged. A new test asserts what a finished cut holds: the chunk levels, not the audio.
- `bench/long_recording_owner_cut.ts` rebuilt the cut the owner listened to and judged on 2026-09-12, through the new path.
  Of its **3,862,481 lines exactly one differs**: `<pathurl>`, because long-recording.mp4 has since moved from
  `C:\Users\user\Downloads` to `G:\Streams`. Every KeepSegment is identical. The bench used to hash
  whole files, so it reported this as a different cut; it now compares without the Recording's path and says when
  only the path differs.

No Premiere import check is needed: the exported XML is byte-identical apart from where the Recording lives.

## Shape of the change

- `ChunkLevels` (`src/level/detectLoudness.ts`) and `ReadSourceTrack` (`src/analysis/analyseRecording.ts`).
- `CutResult.listened` is `ChunkLevels[]`; `CutResult.read` replaces `decoded` and holds `ReadSourceTrack[]`.
- `analyseRecording(request, tools, alreadyRead: ReadSourceTrack[])` and `runCut(…, alreadyRead)`.
- The main process keeps `sourceTracksRead: Map<number, ReadSourceTrack>`, emptied with the Recording.
- `waveformOf(read)` picks out what crosses to the window. The chunk levels stay behind: the window decides nothing
  from them, and they would add three times the waveform's own size to what crosses.
- `PEAKS_PER_SECOND` moved to `src/waveform/peakEnvelope.ts`, beside what it configures.
