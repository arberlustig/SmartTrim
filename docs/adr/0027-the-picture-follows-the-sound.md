# The picture follows the sound, decoded with WebCodecs from the Recording's own index

A moving picture of the Recording sits above the SourceTracks of the Tab on screen. While a SourceTrack plays, the
picture runs with the sound and jumps at every Join; while nothing plays, it shows the still frame under the Playhead.

The owner asked for it on 2026-09-13 as the last of four agreed steps. What was agreed, proposed with the seams:

- **Above the SourceTracks, and it folds away.** Folded or not is one choice for every Tab and is kept when SmartTrim
  starts again (`localStorage`, since it is a convenience of this window and nothing else reads it).
- **It follows the SourceTrack whose ▶ plays and jumps at the Joins** when skipping what the cut removes.
- **Stopped, it shows the still frame under the Playhead** — the first frame while there is none. A click on a waveform
  moves it; zooming and dragging the view do not.
- **The picture is silent.** The sound stays exactly as ADR-0022 made it, so the Joins stay exact in the sound.
- **As wide as the waveforms and at most 450 px high**, in the Recording's own shape. 360 px was proposed; the owner
  asked for "ein Ticken größer".

It was built twice. The first build used two `<video>` elements and stuttered at every Join; the second decodes the
picture itself with WebCodecs and is what is on main now.

## The first build: two `<video>` elements

Measured before building, in an Electron 44.3.0 window (Chromium 152, RTX 4060, 90 Hz screen) with both test
Recordings, HEVC 1080p60 with a keyframe every 250 frames (4.17 s): `<video>` decodes them in hardware, the 23 GB Recording
included; a paused seek takes 7–8 ms just after a keyframe and 160–240 ms just before the next; a second element seeked
ahead while the first plays takes up to 750 ms to get there. ffmpeg is far too slow for a picture (a single frame
250–1000 ms). `app.getGPUFeatureStatus()` says `disabled_software` straight after `ready` and `enabled` a second later.

So the picture read the Recording through SmartTrim's own address (`smarttrim-video://tab/<id>`, answered from
`fs.createReadStream`, since `net.fetch` of the file never answered on the long Recording), two muted elements took turns at the
Joins, and the one behind waited seeked at the next Join.

The owner's first look: "sobald ein Cut erfolgt … alles ist langsam und auf einmal lagged es". That was a **seek
storm**: an element taking over while still seeking reports the moment it seeks to, the sound ran on, and the window
told it to seek again every frame. After that fix the owner said "Immer noch zu ruckelig", and counting the frames
really presented showed why — every stutter sat at a Join:

| case | frames shown per second | gaps over 50 ms | longest gap |
|---|---|---|---|
| without skipping | 59–60 | 0 | — |
| skipping, two `<video>` elements | 52–56 | about 7, every one at a Join | 56–78 ms, once 256 ms |
| skipping, next Join not made ready ahead | 28–34 | 21–31 | 234 ms |

A ready, paused element takes 56–78 ms to show a moving frame once told to play. A run-up (starting the waiting element
a quarter of a second early) made it worse, because two 1080p60 HEVC elements decoding at once slow each other down.
Four to five frames per Join was the floor with `<video>`.

**Measuring gotcha, still true:** a test window covered by other windows is reported hidden by Windows' occlusion
tracking and gets no animation frames, which looks exactly like a slowdown ending in a freeze. Start Electron with
`--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`
and check `document.visibilityState`.

## Below the floor: the WebCodecs prototype

Asked whether to live with it, the owner chose to try another way ("Ganz ehrlich B. Gleich ausprobieren"). A throwaway
prototype (branch `prototype/webcodecs-picture`) decoded the kept pieces of 8 s of what is played with a hardware
`VideoDecoder`, at most half a second ahead, and drew the frame due on a canvas. At the three densest stretches of the
owner's cut (7–8 Joins in 8 s, pieces down to 0.07 s):

| how the frames are kept | frames shown per second | gaps over 50 ms | first frame of a piece, latest | queued |
|---|---|---|---|---|
| decoder's own frames held | 58–59 | 1–4, up to 122 ms | 108 ms | 12–17 frames |
| copies at full size (`createImageBitmap`) | 59–60 | one of 145 ms at a first Join | 134 ms once, else 10–12 ms | 44 frames, ~365 MB |
| copies at 960×540 | **60** | **none** | **23 ms** | 44 frames, ~91 MB |

The hardware decoder turns out 1051–1058 frames a second, so reaching a piece from its keyframe (up to four seconds of
frames decoded and thrown away) fits easily between Joins. Holding the decoder's own frames stalls it: it has a dozen
or so surfaces.

## The build on main: WebCodecs

The owner approved the seams and four defaults ("Passt"): a) H.264 and HEVC, anything else the red note; b) frames
copied at 960 px wide, about half a second ahead; c) looks and behaviour unchanged; d) the Recording's index read when
the picture first needs it, not on opening.

### The Recording's own index

`videoIndexOf(path)` in `src/video/videoIndex.ts` reads the video track's sample tables straight out of the MP4's
`moov` (stts, ctts, stsz, stsc, stco or co64, stss, the edit list, and the avcC or hvcC record for the decoder, whose
codec it names the RFC 6381 way). ffprobe, as the prototype used it, took 0.16 s for 18 s of video; the whole index
takes 35 ms for the owner's 25-minute capture and 147 ms for the long Recording from the external drive (a 15.7 MB `moov`, 546,692
frames). `readFrameBytes` reads a batch of frames in one go and copies each out, since IPC would carry a view's whole
buffer with every frame.

Times follow libavformat, so they can be compared with ffprobe tick for tick. Two rules only real files showed:

- **OBS writes signed composition offsets** (ctts version 1, down to −1 frame) with the edit list starting at zero.
  libavformat then moves every decode time back by the most negative offset. Before this rule every dts on the 25-minute capture and
  the long Recording lay one frame off ffprobe's, while pts, positions and sizes already matched.
- **the long Recording keeps its chunk offsets in co64**, as any Recording past 4 GB must; the 25-minute capture (3.9 GB) still uses stco.

A fragmented MP4 (empty sample tables, frames in `moof` boxes) is refused rather than read as a picture without frames.
Checked on the real files against ffprobe over 10 s stretches: 0 differences on the 25-minute capture and on the long Recording, the frame counts equal
ffprobe's `nb_frames`, and both name their codec `hvc1.1.6.L123.90`.

### What to decode for each piece

`picturePlanOf(index, pieces)` in `src/video/picturePlan.ts` gives, for every kept piece, the frames to feed in decode
order and the frames to show with the moment of what is played each goes on screen:

- **The first frame shown is the one on screen at the piece's first moment**, the latest shown at or before it, shown
  from the piece's start — as Premiere would show it. The prototype dropped every frame before the start instead.
- Decoding starts at the latest keyframe shown at or before that moment and ends with the last shown frame to be
  decoded. Every piece starts again at a keyframe, and the decoder is flushed between pieces.
- HEVC allows **open groups**: frames decoded after a keyframe but shown before it. So the search runs to the *second*
  keyframe shown after the piece; stopping at the first puts the wrong frame on screen (a test holds it).
- Reading every frame of the long Recording for each of 80 pieces took 912 ms. Keyframes are found by halving instead: 31 ms, and the
  same plan for 80 dense pieces, 300 scattered pieces and 300 still frames on the long Recording.

`stillFrameOf(index, seconds)` is a piece that ends where it starts: the frame on screen and what to decode for it.

### In the window

The main process keeps the index per Tab, read the first time the picture needs it; a read that failed is not kept, so
a sleeping drive is tried again. The window asks `picture:plan`, `picture:still` and `picture:frames`, each naming its
Tab, so only a Tab's own Recording is read; frames come 30 to a request, and a request spanning more than 64 MB is
refused as a fault. `src/renderer/picturePlayer.ts` holds the decoding: `PictureRun` feeds the pieces in order, never
more than 0.5 s of decoded frames ahead of the sound, copies each frame at 960 px wide and draws the one due on every
animation frame; `drawStill` decodes one frame. The decoder is asked for in the graphics chip first and taken in
software only if that is refused; a codec the window cannot decode, or an index the main process refuses, ends in the
red note under the frame.

**The clock is the sound, read smoothly.** `AudioContext.currentTime` moves in steps of the audio device's buffer. With
it the picture showed 57–59 frames a second — without skipping as well — because now and then two frames fell due in
one animation frame. `getOutputTimestamp()` says when a moment of the context was heard, and the time since then is
added: 60 frames a second, and the picture follows what is heard rather than what is sent to the device. The Playhead
still reads `currentTime` (ADR-0022).

### Measured in the built app

Over the Chrome DevTools protocol, window visible, the owner's Gaming cut on SourceTrack 5, eight seconds each, every
frame drawn on the picture's canvas counted from half a second after the first one:

| where | frames shown per second | gaps over 50 ms | picture after the sound at the start |
|---|---|---|---|
| the 25-minute capture 289.1 s, skipping | 60 | 0 | 120 ms |
| the 25-minute capture 585.9 s, skipping | 60 | 0 | 160 ms |
| the 25-minute capture 1016.4 s, skipping | 60 | 0 | 215 ms |
| the 25-minute capture 289.1 s, not skipping | 60 | 0 | 135 ms |
| the long Recording from G:, 1300 s, skipping | 60 | 0 | 129 ms |
| the long Recording from G:, 4556 s, skipping | 60 | 0 | 168 ms |

- **The start is where it still lags.** The sound needs 0.35–0.9 s to be read (ADR-0022); the plan follows within
  about 50 ms, and the first moving frame 120–215 ms after the sound begins. The still frame, which is the right
  picture, stands meanwhile. One run in six had two gaps of 56 and 62 ms within its first second. Planning while the
  Excerpt is still being read would give the decoder a head start; it is not built and not measured.
- Memory while playing, the 25-minute capture and the long Recording open side by side: window process at most 248 MB, GPU process at most 207 MB, main
  process at most 261 MB. The graphics card's own memory was not measured.

### What went away

Both `<video>` elements, the `smarttrim-video` address with `serveRecording` and `address.ts` and their registration in
the main process, the window's `media-src` in its Content-Security-Policy, and `pictureFor` with its seek slack and its
tests.

## Tested, and not

- `src/video/videoIndex.test.ts` generates Recordings with the vendor ffmpeg and compares with ffprobe, the independent
  reader: every frame of H.264 (libopenh264) and of HEVC with B-frames and an edit list (kvazaar); negative composition
  offsets (`-movflags negative_cts_offsets`); co64, made by rewriting a generated file's stco, since ffmpeg has no switch
  for it; the avcC and hvcC records against ffprobe's extradata, with codec strings worked out by hand; a fragmented MP4
  refused; the bytes of a stretch against ffprobe's packet dump. `codecOf` is tested on the hvcC record of the owner's
  capture, `fixtures/video/obs-hevc-1080p60.hvcC`.
- `src/video/picturePlan.test.ts` uses synthetic indexes in B-frame order: the frame on screen at a piece's start and
  the frames it needs, the still frame of a B-frame decoded after a later P-frame, and an open group. The first test and
  the open-group test were each checked against a broken plan and failed there.
- The window, the decoding and the main process's handlers are glue, untested like the rest of the window (ADR-0012);
  the table above is how they were checked. How the picture looks against the sound, the start in particular, needs the
  owner's eyes.
