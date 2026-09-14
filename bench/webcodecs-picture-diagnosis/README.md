# Diagnosis of the WebCodecs picture (2026-09-13/14)

Measurement scripts from building and then diagnosing the WebCodecs picture (ADR-0027). Not product code. They drive a
running SmartTrim window over the Chrome DevTools protocol and wrap browser functions in the page for the length of a
run; the product has no hooks for them. Paths to the owner's Recordings are absolute.

## Starting a window to measure

- Dev mode as the owner runs it, with the window on DevTools port 9223 and the main process on V8 inspector 9229:
  `npx electron-vite dev --remoteDebuggingPort 9223 --inspect 9229`
- The built app: `node_modules/electron/dist/electron.exe . --remote-debugging-port=9223`. Add
  `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`
  only when the window may be covered: a covered window is reported hidden and gets no animation frames. Always check
  `document.visibilityState` before trusting a number.
- `node cdp.mjs drop "<Recording>"` opens a file; `node cdp.mjs eval "<expression>"`, `node cdp.mjs evalfile <script>`,
  `node cdp.mjs raw <method> <json>`. Settings for a script go in globals first, e.g.
  `node cdp.mjs eval "(globalThis.__row = 1)"`.

## What each script answers

- `recorder.js` + `pings.js` + `report.js`: a passive recording of a whole session, scripted or **by hand** — picture
  draws, late animation frames, long animation frames, clicks, sound starts, decoders/VideoFrames/ImageBitmaps made and
  closed, an IPC ping every 25 ms and a window timer. `report.js` breaks it down per playback. This is what found the
  bug: synthetic runs missed it twice, the owner's own session did not.
- `stress.js`, `stress2.js`: the owner's steps as a script (clicks, drag, wheel, fold, cut, jumps); `__keepFolded` for the
  differential run.
- `startprobe2.js`: the timeline of one play start per VideoDecoder (fed, queue length, outputs, flush), image copies and
  draws. Showed the playback decoder draining at 60 frames a second.
- `decoderate.js`, `decoderate2.js`, `brakevariants.js`, `brakemini.js`, `decodeworker.js`: the same real frames decoded
  at rest and while the page draws something on every animation frame, one kind of drawing at a time, and in a worker.
  `decodeworker.js` needs a worker file served by the dev server (it was a throwaway `bench/probe-decode-worker.js`).
- `switches.mjs`: starts the built app once per set of Chromium switches and runs `brakemini.js` in it.
- `micro.js`: WebCodecs steps alone, without SmartTrim's picture code.
- `ipcsize.js`: what the contextBridge costs by answer size. `profile.mjs`, `mainprofile.mjs`: CPU profiles of the window
  and the main process while a scenario runs. `memsnap.mjs`: memory of both processes.
- `smoothwc.js`, `smoothwc2.js`, `alternate.js`, `firstplaycut.js`, `playzoomed.js`, `startprobe.js`: earlier loops.
- `realindex.ts`, `planequal.ts` + `picturePlanReference.ts`: the video index against ffprobe on the 25-minute capture and the long Recording, and the fast
  picture plan against the slow one.

## What they found

Whenever the page puts anything new on screen each animation frame, a WebCodecs hardware HEVC decoder hands out about
63 frames a second, against 850-1100 at rest. Details, and what did not lift it, are in ADR-0027.
