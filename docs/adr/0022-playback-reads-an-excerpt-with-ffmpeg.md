# Playback reads an Excerpt with ffmpeg instead of letting Chromium pick the SourceTrack

The window plays one SourceTrack at a time. It does so by reading an Excerpt — the SourceTrack's sound over the
stretch the waveform shows, both Channels, at its own sample rate, at most three minutes — with ffmpeg in the main
process, and building what is played from it: skipping what the cut removes means putting the kept stretches of the
Excerpt back to back, each cut at the sample nearest its edge.

The plan agreed with the owner on 2026-09-12 already said ffmpeg, but for a reason that turned out to be false:
that Chromium cannot choose one audio track out of an MP4. It can. The owner was shown the measurements below and
chose on 2026-09-13 to stay with ffmpeg ("bleib beim ffmpeg-Weg").

## What Chromium can do, measured

A hidden window of the same Electron (44.3.0), playing through Web Audio into a silent gain so nothing reached the
speakers, with pitch and level read off an analyser:

- Without `webPreferences.enableBlinkFeatures: "AudioVideoTracks"`, `HTMLMediaElement.audioTracks` does not exist.
- With it, every audio track of an OBS MP4 is listed — h264 or hevc, and long-recording.mp4 itself with its six — and only the
  enabled one plays. Three tone SourceTracks switched 439 → 999 → 1998 Hz; on the long Recording, SourceTracks 2 and 4 were silent,
  exactly the ones the scan calls EmptyTracks. Both Channels stay apart (440 Hz left, 1000 Hz right came out as such).
- Seeking a 23 GB Recording on the slow external drive took 38–129 ms.

What rules it out is skipping what the cut removes. An `<audio>` element has to be told to jump at each Join, and:

| way of jumping | silence at a Join, median | worst | removed sound heard before the jump |
|---|---|---|---|
| one element seeks | 42 ms (the long Recording) / 60 ms (25-minute capture) | 183 / 200 ms | up to 21 ms |
| a second element waits already seeked, then takes over | 11 ms / 11 ms | 58 / 91 ms | up to 21 ms |

The owner listens in order to judge the Joins — whether the Margin's frames are audible, whether a cut feels
coarse. An error as large as their own 0.05 s Margin would put stumbles into the sound that the Premiere sequence
does not have.

One more thing that would have had to be solved: in development the window is loaded from `http://localhost`, so
the Recording would have to come through a custom protocol. `protocol.handle` passing the request on to
`net.fetch` of the file gave no result within 120 s on the long Recording; a handler answering Range requests itself from
`fs.createReadStream` worked as well as `file://`.

## What ffmpeg does, measured

`-ss` before `-i`, one SourceTrack, native rate, 16-bit stereo to a pipe:

| Recording | 10 s | 3 min |
|---|---|---|
| long-recording.mp4 on the slow external drive | 0.26 s | 0.42 s |
| 25-minute capture on the internal SSD | 0.11 s | 0.26 s |

Is it the right stretch? A 3-minute Excerpt was compared with the same stretch cut out of a decode from the very
start of the file, the independent truth, on two Recordings (at 600 s and at 1300 s). The best alignment was a lag
of **0 samples in every 10-second block of the three minutes** — no shift and no drift. This differs from
ADR-0011's slices, which were shifted; those were resampled to 16 kHz, and an Excerpt never is.

The samples are not bit for bit the same: 77 % and 90 % identical, with differences spread through the whole
window rather than at its start. The cause is not known. It changes nothing about where a Join sits.

## Consequences

- An Excerpt lasts at most three minutes (`LONGEST_EXCERPT_SECONDS`), the owner's limit: 33 MB of stereo at 48 kHz.
  Zoomed out further than that, the window has to choose which three minutes to play.
- Every Excerpt is read afresh and dropped once played. Nothing of it is kept, unlike ChunkLevels (ADR-0021).
- The Recording is only read (ADR-0006), and reading an Excerpt is not a second analysis of it (ADR-0004): it is a
  few megabytes for the ear, not the read the cut is decided from.
- `enableBlinkFeatures` stays off. It is an experimental Blink feature and nothing depends on it.

## Shape

- `readExcerpt(recording, sourceTrack, fromSeconds, toSeconds, ffmpegPath)` in `src/playback/readExcerpt.ts` runs
  ffmpeg and refuses an unknown SourceTrack, a stretch of no length and one longer than `LONGEST_EXCERPT_SECONDS`
  before starting it.
- `playbackOf(excerpt, kept, skipRemoved)` and `recordingSecondsAt(playback, playedSeconds)` in
  `src/playback/playback.ts` are pure; the constant lives there because the window imports it, and `readExcerpt.ts`
  would pull ffmpeg into the window's bundle. `playbackOf` refuses to skip through an Excerpt the cut keeps nothing
  of, rather than playing silence.
- IPC `sourceTrack:excerpt` takes `{ position, fromSeconds, toSeconds }` and refuses when another Recording was
  chosen while ffmpeg ran, like `sourceTrack:read`.
- The window plays through Web Audio (an `AudioBuffer`, not an `<audio>` element), which is what keeps the Joins
  exact. The playhead is read off `AudioContext.currentTime`; only the playing SourceTrack's canvas is redrawn per
  frame. A press on another row, choosing a Recording, opening a project, pressing Schneiden or setting the playing
  SourceTrack to "wird ignoriert" stops the sound. The switch "überspringen" appears only once there is a cut, and
  flipping it while playing starts that SourceTrack again the new way.
- The Playhead (CONTEXT.md) is settable, asked for by the owner after the first listening check: "ich selber kann
  den Strich nicht setzen, sodass ich entscheiden kann wo ich starten möchte". A click on any waveform — a press
  that moves less than 4 px, anything more is a drag that pans — puts it there, and jumps there while playing.
  Stopping leaves it where the sound stopped instead of making it vanish. ▶ plays up to three minutes from it, past
  the edge of the view, and the view turns a page when the Playhead runs out of it — but not when the user has
  moved the view away while listening. A Playhead out of view is ignored: ▶ then starts at the left edge of what is
  shown, since playing from a place the user cannot see would be a surprise.
- One AudioContext serves the whole window and is never closed; stopping disconnects the sound's node only. A
  context per press would get an audio device going on every click-to-jump. The saving is not measured: the
  browser pane checks were run on a hidden page that got 3 animation frames and about one timer a second, which
  also made every latency it reported meaningless. Positions, requests and paging were checked there; how quickly
  a click is heard needs the real window.

## Tested, and not

`readExcerpt` runs the real ffmpeg on a generated Recording whose SourceTracks differ left from right and in sample
rate, and whose second SourceTrack changes pitch at a known moment; the test was confirmed to fail when the sample
rate is assumed or the Excerpt starts 20 ms late. `playbackOf` and `recordingSecondsAt` are pure and tested on an
Excerpt whose samples carry their own frame numbers, so which frames are played can be read off the result. The
play button, the playhead and the Join marks are drawing, untested like the rest of the window (ADR-0012).
