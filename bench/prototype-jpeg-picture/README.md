# Prototype: the picture as JPEG frames that ffmpeg makes ahead (2026-09-14)

Throwaway code on branch `prototype/jpeg-picture`, never to be merged. It answers one question: can the picture above
the SourceTracks start with the sound and show no visible hitch at any Join **in the owner's own use**? Two ways had
failed that: two `<video>` elements (a hitch of 4–5 frames at every Join, the start latency of a paused element) and
WebCodecs (a hardware decoder braked to about 63 frames a second whenever the window draws), both in ADR-0027.

## What the owner decided before it was built

- No hitch at Joins: never more than one frame's pause between two frames shown (measured: no gap over 34 ms on the
  owner's 89 Hz screen), also in dense stretches and after cutting.
- Sound and picture start together; the sound may come up to 0.3 s later than without a picture, also when a click
  jumps while playing.
- 60 frames a second at about 800×450 is enough; 30 a second only as a fallback that clearly helps.
- Work done ahead lives in memory only, at most 2 GB, **no copies on disk**. Should users' memory not suffice, a
  small preview copy on disk is the next step (owner, 2026-09-14).
- ▶ pressed before the work ahead is done: wait at most the 0.3 s, then play; a hitch in the first seconds is allowed
  then.

## How it works

- `src/main/prototypeJpegPicture.ts`: ffmpeg (`-hwaccel cuda`, `scale_cuda` to 800×450, MJPEG quality 8,
  `image2pipe`) decodes from the Playhead up to three minutes ahead. The JPEGs are kept in the main process by frame
  index; frame k is the frame at k/fps (checked on the 25-minute capture: the same bytes whichever frame ffmpeg starts from, and
  `showinfo` gives pts k/60). Below-normal priority and 4 threads (see the numbers). Frames are let go beyond 1.5 GB.
  Without a working CUDA decoder it falls back to the processor once.
- `src/renderer/renderer.ts`, picture section: a canvas. Every animation frame draws the frame due at the moment
  leaving the speakers (`AudioContext.getOutputTimestamp` and `recordingSecondsAt`), and unpacks the next half
  second with `createImageBitmap`. ▶ waits up to 300 ms for the first quarter second of frames. A click while stopped
  asks for the still frame the same way.
- `checks/`: the two counter-checks run before building it (below).

## Running it

- The window: launch configuration `electron-measure` (`electron-vite dev --remoteDebuggingPort 9223 --inspect
  9229`). Main appends the occlusion switches, so a covered window keeps drawing.
- `node bench/prototype-jpeg-picture/setup.mjs ["<Recording>"]`: recorder and pings, the Recording opened,
  SourceTrack 5 cutting, cut with the Gaming preset.
- `node bench/prototype-jpeg-picture/playtest.mjs [seconds ...]`: real mouse events: Playhead there, ▶, wait, ■.
  `TOTAL_SECONDS` skips measuring the Recording's length, `PLAY_MS` sets how long each play lasts, `FOLD=1` folds
  the picture away first (the baseline: the sound as on main).
- `node bench/webcodecs-picture-diagnosis/cdp.mjs evalfile bench/prototype-jpeg-picture/report.js`: per press of
  ▶ the Excerpt time, the wait for the picture, press to audible sound, how late the picture's first moving frame
  was, frames drawn a second, gaps, frames that were not ready; stills, ffmpeg runs, memory. Set
  `globalThis.__compact = true` first for one line per play.
- `window.smarttrimPrototype.tune({ priority, threads })` and `.forget()` change the ffmpeg runs without restarting.

## Counter-checks before building

- **WebCodecs in a second window** (`checks/main.cjs brake`): a hidden window and a shown window that draws nothing
  decoded 60–63 frames a second while a third window drew, 1320–1344 at rest. The brake holds the whole app, so a
  helper window is no way around it.
- **`<video>` without its audio tracks** (`checks/main.cjs videostart`, `enableBlinkFeatures: AudioVideoTracks`): a
  paused, seeked element showed its first moving frame 53–69 ms after `play()` with its six audio tracks enabled and
  the same with all disabled, alone or while another element played. Seeking while another plays: up to 480 ms.

## The owner's own session (2026-09-14)

The owner used the measuring window by hand for about seven minutes, both Tabs (the 25-minute capture and the long Recording, each cut on SourceTrack
5), with recorder.js and pings.js installed, and said: "Bild läuft flüssig." What the recorder saw:

- 12 plays, 7 of them skipping through 31–55 kept pieces: 57–60 frames drawn a second, one gap of 34 ms (one screen
  refresh late) in the whole session, **no frame that was not ready when due**.
- The first moving frame 2–27 ms after the sound (median 12). The wait for the picture before the sound: 0–26 ms; the
  300 ms limit was never reached.
- Press to audible sound 599–849 ms (median 667), the Excerpt read 463–694 ms. No folded baseline in this session;
  the scripted ones below put the picture's share at about 0.16 s (the 25-minute capture) and 0.24 s (the long Recording).
- 18 still frames: median 8 ms, at most 579 ms (a place ffmpeg had not been to).
- The window's thread stood still once for 134 ms; IPC round trips to the main process up to 156 ms.
- 645 MB of frames held at the end, main process 858 MB.

## Scripted results

Three dense stretches of the owner's Gaming cut on the 25-minute capture (289.1, 585.9, 1016.4 s; 33–42 kept pieces in 11 s), skipping:

| variant | press to audible sound | added by the picture | picture |
|---|---|---|---|
| picture folded (as main) | 442–506 ms | — | — |
| picture, normal priority | 636–770 ms | about 245 ms | 60 frames/s, no gap over 34 ms |
| picture, low priority | 625–718 ms | about 180 ms | 60 frames/s, one gap of 49 ms |
| picture, low priority, 4 threads | 612–662 ms | about 155 ms | 60 frames/s, no gap over 34 ms |

Almost all of the added time is the Excerpt read slowing down while ffmpeg makes frames; the wait for the picture
itself was 20–30 ms. The first moving frame came 1–14 ms after the sound. ffmpeg made 1300–1500 frames a second, the
first after 260–420 ms; a still frame at a new place took 315–414 ms.

the long Recording from the slow external drive (1200, 4500, 8000 s): 60 frames a second, no gap over 34 ms, first moving frame
11–64 ms after the sound; ffmpeg still 1300–1500 frames a second, so the drive is not the limit. A baseline at places
already read is unfair on that drive (the system's file cache had them), so the comparison was repeated at places
never read, alternating folded / picture / folded / picture: press to audible sound 599–682 ms folded, 793–880 ms
with the picture, about 235 ms added (160–280); the picture again 60 frames a second, no gap over 34 ms, 0–16 ms after
the sound. After four places,
1.5 GB of frames were held and the main process stood at 1.8 GB: the budget only acts at 1.5 GB, far more than one
three-minute stretch (340–600 MB) needs.

Also seen, not caused by the picture: the window freezes 145–560 ms when ▶ fills the AudioBuffer sample by sample
(found in the WebCodecs diagnosis too), and the main process stalls up to 470 ms while a Recording's SourceTracks are
read.
