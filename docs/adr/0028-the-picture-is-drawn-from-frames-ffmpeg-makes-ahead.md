# The picture is drawn from frames ffmpeg makes ahead

The picture above the SourceTracks is no longer played by two `<video>` elements through SmartTrim's own address
(ADR-0027). ffmpeg makes small JPEG frames of the stretch ▶ would play into the main process's memory, and the window
draws the frame due at the moment leaving the speakers on a canvas. What the picture looks like and does — above the
SourceTracks, folds away, follows the SourceTrack whose ▶ plays, jumps at the Joins, the still frame under the Playhead,
silent, at most 450 px high — stays as ADR-0027 records it.

## What the owner asked for

Grilled on 2026-09-14, after the two-`<video>` picture hitched at every Join and the WebCodecs picture started late:

- **No hitch at a Join.** Never more than one frame's pause between two frames shown — measured as no gap over 34 ms on
  the owner's 89 Hz screen — in dense stretches and after cutting too.
- **Picture and sound start together.** The sound may come up to 0.3 s later than without a picture for it, also when a
  click jumps while playing.
- **About 800×450 at 60 frames a second** is enough. 30 a second only if it clearly helped.
- **Work done ahead lives in memory only, at most 2 GB, no copies on disk.** Should users' memory turn out not to
  suffice, a small preview copy on disk is the next step (owner, 2026-09-14).
- **▶ pressed before the work ahead is done:** wait at most the 0.3 s, then play; a hitch in the first seconds is
  allowed then.
- Accepted as proposed: the work ahead is done only for the Tab on screen and only while the picture is unfolded; it
  covers what ▶ would play next, from the Playhead, nearest first; the window stays as fluid as before; the same holds
  for the 25-minute capture on the internal SSD and the 2.5-hour Recording on the slow external drive.

## Why this way

Four ways were weighed with the owner:

- **Two `<video>` elements, improved.** A paused, seeked element needs 53–69 ms after `play()` to show a moving frame —
  with its six audio tracks enabled or all of them disabled (`enableBlinkFeatures: "AudioVideoTracks"`), alone or beside
  a playing element — and seeking beside a playing element takes up to 480 ms. Every Join stays a seek from a keyframe
  up to 4.17 s back, so short kept stretches cannot be ready in time.
- **One `<video>` with MediaSource, the kept pieces appended back to back.** Appended media can only begin at a
  keyframe: frames before the append window, and everything that depends on them, are dropped until the next keyframe.
  With OBS's 4.17 s between keyframes a piece could not start where the cut puts it without making new video.
- **WebCodecs in a second window that draws nothing**, to get past ADR-0027's brake. The brake holds the whole app: a
  hidden window and a shown window that drew nothing decoded 60–63 frames a second while a third window drew, 1320–1344
  at rest. WebCodecs is out.
- **ffmpeg making small frames into memory, the window drawing them by the sound's clock.** ffmpeg is a process of its
  own, outside Chromium's decoder, and a Join is only another frame number. Chosen.

The two counter-checks and the prototype live on branch `prototype/jpeg-picture` (`bench/prototype-jpeg-picture/`).

## What the prototype measured

In the window, not only in scripts: the owner used it by hand for seven minutes with a passive recorder installed and
said "Bild läuft flüssig". The recorder saw 12 plays, 7 of them skipping through 31–55 kept pieces: 57–60 frames drawn a
second, one gap of 34 ms in the whole session, no frame that was not ready when due, the first moving frame 2–27 ms after
the sound, the sound's wait for the picture 0–26 ms, 645 MB of frames.

Scripted, at the three densest stretches of the owner's Gaming cut of the 25-minute capture (289.1, 585.9, 1016.4 s):

| ffmpeg for the frames | press of ▶ to audible sound | added by the picture | picture |
|---|---|---|---|
| picture folded (no frames made) | 442–506 ms | — | — |
| normal priority, ffmpeg's own threads | 636–770 ms | about 245 ms | 60 frames/s, no gap over 34 ms |
| below-normal priority | 625–718 ms | about 180 ms | 60 frames/s, one gap of 49 ms |
| below-normal priority, 4 threads | 612–662 ms | about 155 ms | 60 frames/s, no gap over 34 ms |

- Almost all of the added time is the Excerpt read slowing down while ffmpeg works beside it; the wait for the picture
  itself was 20–30 ms.
- the long Recording from the external drive, at places never read before (the file cache made re-read places look fast): 599–682 ms
  folded against 793–880 ms with the picture, about 235 ms added. ffmpeg still made 1300–1500 frames a second there, so
  the drive is not the limit.
- Frame k is the frame at k / fps: the same JPEG bytes whichever frame ffmpeg starts from, and `showinfo` reported pts
  k/60, checked at 289.1, 585.9 and 1016.4 s of the capture.
- ffmpeg with CUDA made 900–1500 frames a second, the first 260–530 ms after starting; on the processor alone 400.
  Three minutes are 340–600 MB of frames at quality 8.

## Shape

- `newPictureFrames(ffmpegPath, options)` in `src/picture/pictureFrames.ts` holds one Recording's frames by number:
  `want(recording, fromSeconds)` asks for three minutes from a moment and returns at once, `frames(recording, indices)`
  hands out what is made, `heldBytes()` and `runs()` tell the measuring scripts how it is doing, `stop()` ends it.
  ffmpeg runs with `-hwaccel cuda`, `scale_cuda` to 450 px high, MJPEG quality 8, `-threads 4`, below-normal priority,
  one JPEG after another down a pipe, parsed by their markers. `-ss` is the first frame's own time rounded down to a
  microsecond, since ffmpeg keeps the first frame not before it.
  - A wish starts ffmpeg on the first frame still missing and stops where frames already are; a run about to reach it
    within a second is left alone, any other run is stopped.
  - A graphics decoder that fails with no frame gets one retry on the processor. Three empty runs in a row drop the
    wish, so a stretch ffmpeg cannot give is not asked for without end.
  - Beyond `PICTURE_BUDGET_BYTES` (1 GiB) the frames outside the stretch wished for go, farthest from it first, down to
    nine tenths of the limit, so the sorting happens once in a while rather than for every frame.
- `TabStore` holds one `PictureFrames` for the whole window. A wish for another Tab's Recording lets go of the frames of
  the one before; closing the Tab the picture was last wished for stops ffmpeg. IPC `picture:want`, `picture:frames`,
  `picture:state`.
- `framesDue(playback, audibleSeconds, video, aheadSeconds)` and `frameAtSeconds(video, seconds)` in
  `src/picture/framesDue.ts` are pure: the frame due now and the frames the next moments show, across Joins, never past
  the last frame.
- The window draws on a canvas. Every animation frame it draws the frame due at the moment leaving the speakers
  (`AudioContext.getOutputTimestamp`, so the picture keeps to the sound as heard, not to the audio clock's buffer) and
  unpacks the next half second with `createImageBitmap`. ▶ asks for the picture from where it will start while the
  Excerpt is read, and the sound waits up to 300 ms for the picture's first quarter second. A click while stopped asks
  for the still frame the same way.
- The sound per Channel: `Playback.channels` holds one `Float32Array` from -1 to 1 per Channel, so ▶ copies each Channel
  into the AudioBuffer in whole. Converting three minutes sample by sample there stood the window still for 145–560 ms,
  which delayed the sound on every press.
- Gone: the two `<video>` elements, the `smarttrim-video` scheme and its registration, `serveRecording`,
  `videoAddressOf`, `pictureFor` and their tests, and `media-src` in the Content-Security-Policy.

## Consequences

- The sound comes about 0.16 s (SSD) to 0.24 s (external drive) later than with the picture folded, within the owner's
  0.3 s but not by much. The cost is the Excerpt read sharing the machine with ffmpeg.
- Every place clicked that ffmpeg has not been to costs about 15 s of graphics card and processor on the owner's machine
  for three minutes of frames. A machine without a working CUDA decoder decodes on the processor, about 6.7 times
  faster than the picture plays — not measured in the window.
- Up to 1 GiB of frames lie in the main process, more briefly while a run fills a stretch. Only one Recording's frames
  are held, so showing another Tab starts over there.
- A Recording ffmpeg makes no frames of shows no picture, without a word once the wish is dropped. Recordings the probe
  refuses never open at all (ADR-0009).
- If users' memory does not suffice, the next step is a small preview copy on disk — the owner's own condition.

## Accepted in the built app

2026-09-14, `bench/picture-acceptance/` in the built SmartTrim, Recordings cut on SourceTrack 5 with the Gaming preset,
each play 5–6 s with skipping, the picture folded away for the baseline:

| | press of ▶ to audible sound | first new frame after the sound | frames drawn a second | gaps over 34 ms |
|---|---|---|---|---|
| 25-minute capture, dense stretches, folded | 462–683 ms (median 473) | — | — | — |
| 25-minute capture, dense stretches, picture | 663–738 ms (median 684) | 6–24 ms | 60 | none |
| the long Recording from the external drive, places never read, folded | 621–848 ms (median about 650) | — | — | — |
| the long Recording from the external drive, places never read, picture | 829–983 ms (median about 895) | 4–27 ms | 59–60 | none |

- The picture meets the owner's conditions: no gap over 34 ms in any play, the first new frame within a frame and a half
  of the sound.
- The sound comes about 0.21 s (capture on the SSD) and 0.24 s (the long Recording on the external drive) later than with the picture
  folded, as in the prototype. Single plays on the long Recording came up to about 0.33 s later than the folded ones around them — a
  hair over the owner's 0.3 s, and put to the owner as such.
- A still frame at a place ffmpeg had not been to: 421–480 ms. The frames held stayed at the limit, 990–1060 MB.
- Still there, not caused by the picture: the window stands still 134–223 ms around a press of ▶ (the prototype saw up
  to 560 ms before the Channels came ready), and the main process answers IPC 100–240 ms late while an Excerpt is read.

## Tested, and not

- `src/picture/pictureFrames.test.ts` runs the real ffmpeg on a generated H.264 Recording whose frames each have a
  brightness of their own, a keyframe every 3 s; reference frames are picked by number from a decode of the whole video,
  never by a time. Frame k is the frame at k / fps from two different start points (checked red with every frame filed
  one number late); a wish elsewhere stops the run at work and frames already made are not made again; beyond the limit
  the frames farthest from the stretch wished for go first (checked red with the nearest going first); a graphics decoder
  that fails still gives frames from the processor (checked red with the retry removed).
- `src/picture/framesDue.test.ts`: the frame due and the frames ahead across a Join; before the sound starts, and past
  the last frame (red before the last frame was a limit).
- `src/playback/playback.test.ts`: the Channels come apart, from -1 to 1, cut at the same frames as before.
- The canvas, the wait before the sound, the still frame and the wiring to the Tab are window glue, untested like the rest
  of the window (ADR-0012). They are accepted with `bench/picture-acceptance/` — a passive recorder, a report and
  scripted plays at the dense stretches, then the owner's own use — as the prototype was.
