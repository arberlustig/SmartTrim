# The picture follows the sound, through two video elements and SmartTrim's own address

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
- **The picture jumps when it lies more than 0.1 s from the sound** (`PICTURE_SLACK_SECONDS`), and at a Join the next
  place is made ready ahead, so it follows within a frame or two.

## What was measured first

Before anything was built, a hidden-free Electron 44.3.0 window (Chromium 152, RTX 4060, 90 Hz screen) played both
test Recordings, HEVC 1080p60 with a keyframe every 250 frames (4.17 s):

- `<video>` decodes both in hardware, over `file://` and over a custom protocol with its own Range handler, the 23 GB
  the long Recording included: 598–599 frames in 10 s, none dropped.
- A paused seek takes 7–8 ms just after a keyframe and 160–240 ms just before the next one — decoding from the
  keyframe dominates, the slow external drive barely matters.
- With two elements, the second one seeked ahead while the first plays: seeking ahead takes up to 750 ms (two to three
  times longer than when idle); once ready, its first moving frame comes 22–33 ms late (median), 44 ms at worst, now and
  then skipping one or two frames at the start. One switch in 80 missed: with only half a second kept before it, the
  element was not ready and came 250 ms late.
- ffmpeg is too slow for a picture: three minutes at 640 px took 20–30 s, a single frame 250–1000 ms.
- `app.getGPUFeatureStatus()` says `disabled_software` straight after `ready` and `enabled` a second later; do not
  judge hardware decoding by the first answer.

So the picture follows the exact Web Audio sound within a few frames at a Join. It is not frame-exact like Premiere,
and was not promised as such.

## Why SmartTrim's own address

In development the window is loaded from `http://localhost`, where `file://` is out of reach, so the `<video>` reads
`smarttrim-video://tab/<id>`. Passing such a request on to `net.fetch` of the file never answered on the long Recording (ADR-0022),
so `serveRecording(request, recordingPathOf)` in `src/video/serveRecording.ts` answers Range requests itself from
`fs.createReadStream`: 206 with the piece asked for, 200 with the whole file when no Range is named, 416 for a piece that
cannot be given. The address **names a Tab, never a path**: the Recording is looked up in the TabStore, and anything
else — a closed Tab, an address holding a path — is a 404. The window can reach this address, so it must not become a
way to read any file on the disk.

The scheme is registered as privileged (`standard`, `secure`, `stream`, `supportFetchAPI`) before the app is ready, as
Electron requires; a `<video>` cannot seek on a scheme that does not stream. The window's Content-Security-Policy
allows `media-src smarttrim-video:` and nothing more. `src/video/address.ts` holds the scheme and `videoAddressOf`, so
the window's bundle does not pull in `node:fs`.

## How the picture follows

The sound is the clock, as it is for the Playhead (ADR-0022). Every animation frame, `pictureFor(playback,
playedSeconds, shownSeconds)` in `src/video/picture.ts` answers where the Recording belongs on screen
(`recordingSecondsAt`), whether the picture lies far enough off to jump, and which Join comes next. The window keeps
two muted `<video>` elements: the one in front plays; the one behind is paused at the next Join's `removedToSeconds`.
When the sound reaches that Join, they swap — the one behind starts playing and comes to the front, the other stops and
waits for the Join after. Anything still more than 0.1 s off after that is seeked.

## A Recording the window cannot show

Chromium raises no `error` for a Recording whose video it cannot decode as long as it can play its sound: it loads it as
sound only, and the picture stays black. It was found with an MPEG-4 Part 2 test Recording whose AAC SourceTracks were
read. The window therefore also checks `videoWidth` once the metadata has loaded, and says in red under the frame that
the picture of this Recording cannot be shown here, as it does for a real `error`.

## What the owner's first look found

The owner watched it on 2026-09-13: in step with the sound for about a second, then "sobald ein Cut erfolgt … alles
ist langsam und auf einmal lagged es".

- **A seek storm.** When the stretch kept before a Join is shorter than the waiting element needs to finish its seek
  (up to 750 ms on HEVC while the other element decodes), the element takes over still seeking. While it seeks it
  reports the moment it is seeking to, the sound runs on, and after a tenth of a second the window told it to seek
  again — every frame, so the seek started over and never ended. Recorded in the window with tagged instrumentation: up
  to 8 seeks started while one was still running in a single 8 s run. `pictureFor` now takes whether the picture is
  still seeking and never asks it to seek again then; the same runs afterwards started none.
- **What it did not fix.** A picture that takes over before its seek ends still stands until that seek ends — up to a
  second in the densest stretch of the owner's cut (8 Joins in 8 s, kept stretches down to 0.4 s) — and each Join still
  costs about a tenth of a second before the next element shows a moving frame. Whether that is good enough is the
  owner's call.
- **Not the cause, but it looked like one.** A test window covered by other windows is reported hidden by Windows'
  occlusion tracking: Chromium then stops its animation frames, and since the picture follows on animation frames, it
  froze completely — which in a long series looked exactly like a slowdown that ends in a freeze. Measure with the
  window visible, or start Electron with `--disable-features=CalculateNativeWinOcclusion
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding` and check `document.visibilityState`. With
  it, ten runs in a row showed no decline (28–32 frames/s shown, 93 animation frames/s). Streams through the address
  do not pile up either: 15 opened, 14 closed, never more than one open.

## Still too choppy: what the second round measured

After the seek storm was fixed the owner said "Immer noch zu ruckelig." The second round counted what the eye sees:
frames the picture on screen really presented (`requestVideoFrameCallback`'s `presentedFrames`, not the number of
callbacks — those came at about 30 a second for a 60 fps picture and misled the first round) and every gap of more than
50 ms between two shown frames. Eight seconds each, in the densest stretches of the owner's cut, window visible:

| case | frames shown per second | gaps over 50 ms | longest gap |
|---|---|---|---|
| without skipping | 59–60 | 0 | — |
| skipping, as built | 52–56 | about 7, **every one at a Join** | 56–78 ms, once 256 ms |
| skipping, waveform not redrawn per frame | 54–57 | 3–10 | 78 ms, once 189 ms |
| skipping, next Join not made ready ahead | 28–34 | 21–31 | 234 ms |

- **The stutter is the start at each Join.** The waiting element is ready and shows the right frame, but once told to
  play it takes 56–78 ms — four or five frames — to show a moving one. In the owner's dense stretches that is about one
  hitch a second.
- Redrawing the waveform every frame costs nothing measurable. Making the next Join ready ahead is necessary: without it
  the picture is far worse.
- **Tried and not kept: a run-up.** The waiting element was set running out of sight a quarter of a second before its
  Join, from a quarter of a second before its target, so it would be moving when the cut came. It made things worse: 49–51
  frames a second in two of three stretches, gaps up to 345 ms at Joins and new gaps of 190–220 ms in the middle of kept
  stretches, and the picture up to 1.9 s off the sound. Two 1080p60 HEVC elements decoding at the same time slow each
  other down — the same contention the first measurement saw when seeking ahead (up to 750 ms instead of 240).

So with two `<video>` elements, a hitch of about four to five frames at every Join is the floor measured on this machine.

## Below the floor: WebCodecs, measured in a prototype

Asked whether to live with it or try another way, the owner chose to try ("Ganz ehrlich B. Gleich ausprobieren"). A
throwaway prototype (branch `prototype/webcodecs-picture`, not on main) decodes the kept pieces of 8 s of what is played
with a hardware `VideoDecoder`, in order, at most half a second of frames ahead of the clock, and draws the frame that is
due on a canvas every animation frame. What it needs from the file: the HEVC configuration from the `hvcC` box
(`hvc1.1.6.L123.90` on the 25-minute capture) and the packets of the stretch from ffprobe (JSON; 0.16 s for 18 s of video).

Same three stretches of the owner's cut, 7–8 Joins in 8 s, pieces down to 0.07 s:

| how the frames are kept | frames shown per second | gaps over 50 ms | first frame of a piece, latest | queued |
|---|---|---|---|---|
| two `<video>` elements (as built) | 52–56 | at every Join, 56–78 ms | — | — |
| decoder's own frames held | 58–59 | 1–4, up to 122 ms | 108 ms | 12–17 frames |
| copies at full size (`createImageBitmap`) | 59–60 | one of 145 ms at a first Join, else none | 134 ms once, else 10–12 ms | 44 frames, ~365 MB |
| copies at 960×540 | **60** | **none** | **23 ms** | 44 frames, ~91 MB |

- The hardware decoder turns out 1051–1058 frames a second — seventeen times what is played — so reaching a piece from
  its keyframe (up to four seconds of frames decoded and thrown away) fits easily between Joins.
- Holding the decoder's own frames stutters: it has only a dozen or so surfaces, and holding them stalls its output.
  Copies at the size the window draws cost a quarter of the memory and were the smoothest.
- The window process stayed near 200 MB. Graphics memory was not measured.

Not measured yet: following the Web Audio clock instead of the prototype's own, the 23 GB Recording on the external drive,
three-minute Excerpts, the still frame on a click, graphics memory. Building it would replace the two `<video>`
elements and the address they read through.

## WebCodecs, built and taken back

The owner chose to build it. On 2026-09-13 it was built test-first on the seams the owner approved: `videoIndexOf` reads
the MP4's own sample tables, `picturePlanOf` says what to decode for each kept piece, and `PictureRun` in the window
decodes a little ahead of the sound. Its acceptance runs over the DevTools protocol passed: 60 frames a second and no
gap over 50 ms at the densest stretches of the 25-minute capture and on the long Recording from the external drive, the first moving frame 70–225 ms
after the sound. It is kept on branch `webcodecs-picture`, with the ADR text it had there and the diagnosis tools in
`bench/webcodecs-picture-diagnosis/`. On 2026-09-14 main went back to the two `<video>` elements above.

The owner's own look found what the scripted runs had not: "hängt das Bild hinterher und braucht erst mal bis es läuft,
Ton läuft aber schon weiterhin", before a cut and after. A recorder left in the window while the owner used SmartTrim
measured the first moving frame 1.6–2.5 s after the sound on every play but the first. A probe of each decoder in that
window showed why. From the moment the sound started, the playback decoder was fed and gave frames back at about 60 a
second with its queue full. So the frames decoded only to get from the keyframe to the start, up to 4.17 s of them,
took as long as they would take to play.

**The brake.** A WebCodecs hardware HEVC decoder in the window hands out about 63 frames a second whenever the page puts
anything new on screen on every animation frame, and 850–1100 at rest. Measured with the same 192 real frames:

| while the decoder runs | frames a second |
|---|---|
| nothing drawn, or an animation-frame loop that draws nothing | 850–1100 |
| a canvas redrawn by a 16 ms timer, no animation frames | 716 |
| a 2D canvas redrawn every animation frame, 32×32 or 1600×200, on the GPU or not | 63–64 |
| a WebGL canvas, a 960×540 `drawImage`, or only an element moved by CSS | 61–63 |
| the same with the decoder in a Worker | 62 |
| two decoders at once | 32 each |

- **Nothing tried lifted it.** Not `--disable-features=CalculateNativeWinOcclusion`, `--disable-backgrounding-occluded-windows`,
  `--disable-renderer-backgrounding`, `--disable-gpu-vsync` or `--disable-direct-composition`. Not
  `--disable-frame-rate-limit`: animation frames rose to 4383 a second and decoding stayed at 66. Not
  `--enable-features=D3D12VideoDecoder`, which was slower at rest and the same while drawing. Not `optimizeForLatency: false`.
- **No way around the hardware.** `prefer-software` is refused for HEVC.
- **Not the machine's settings.** It is a desktop on mains power, its screen at 89 Hz and the window at 91 animation frames a
  second, the system timer at 1 ms.
- **No headroom by design.** The picture's own drawing counts as drawing. A 60-frame picture therefore always runs
  against the brake, and every start and every Join needs frames it cannot get in time.
- **No switch found.** Discussion #680 of w3c/webcodecs names a decoder waiting for output buffers as a cause of stalls.

Two things stay unexplained. The prototype decoded 187–259 frames a second while playing
(`bench/out/prototype-webcodecs-picture.json`). The acceptance runs of 2026-09-13 started the picture quickly. Neither
was measured again under the owner's conditions. What found the fault was not a scripted run but a passive recorder in
the window while the owner used SmartTrim as they do. Measure any picture that way before calling it done.

## Tested, and not

- `src/video/serveRecording.test.ts`, a real file of 1000 bytes that each carry their own place: a named piece, a piece
  to the end and the whole file come back byte for byte; a piece past the end is 416; a closed Tab, an address holding
  a path and a Tab number that is no number are 404.
- `src/video/picture.test.ts`, on a Playback built by `playbackOf` with three kept stretches: within a tenth of a second
  the picture runs on, beyond it jumps; just past a Join it jumps to where the sound went on and has the Join after that
  ready; past the last Join nothing is made ready; a picture still seeking is not told to seek again however far behind
  it looks (written red before the fix). The Join test passed at once, so it was checked against a broken `pictureFor`
  (the next Join taken too early) and failed there.
- The elements, the swapping, the still frame and the fold are drawing, untested like the rest of the window
  (ADR-0012). Checked over the Chrome DevTools protocol on the built app with the owner's 25-minute capture: the picture
  loaded at 1920×1080 and drew 408 px high in an 820 px window; a click at 40 % of the waveform put the still frame at
  605.6 s; while playing with skipping, the elements swapped at the Joins, the one behind waiting at 609.80 s and
  614.82 s and running on at the speed of the clock (2.88 s of picture in 2.92 s); stopping paused both; folding hid the
  frame and was remembered; closing every Tab emptied both elements. How late the picture looks against the sound, and
  the long Recording read from the external drive through the address, need the owner's eyes.
