# Acceptance of the picture (ADR-0028)

Measurement scripts, not product code. The picture's canvas, its wait before the sound and its wiring to the Tab are
window glue without tests (ADR-0012), so they are accepted the way the prototype was: a passive recorder in a running
window, scripted plays at the densest stretches of the owner's cut, and then the owner's own use with the recorder
still installed. Scripted runs alone twice missed what the owner saw (ADR-0027).

## Starting a window to measure

- As the owner runs it, with the window on DevTools port 9223 and the main process on V8 inspector 9229:
  `npx electron-vite dev --remoteDebuggingPort 9223 --inspect 9229`. Keep the window uncovered: a covered window is
  reported hidden and gets no animation frames, and every number turns meaningless. `report.js` prints the visibility.
- For scripted runs while other windows lie on top, the built app with the occlusion switches:
  `npm run build`, then `node_modules/electron/dist/electron.exe . --remote-debugging-port=9223
  --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`.
- Close an installed SmartTrim first: both use the same user folder, and Chromium's cache locks.

## The scripts

- `setup.mjs ["<Recording>"] [--no-cut]`: waits for the window, installs `recorder.js` and `pings.js`, opens the
  Recording, gives SourceTrack 5 "danach schneiden" and cuts with the Gaming preset.
- `playtest.mjs [seconds ...]`: real mouse events: the Playhead at each place, ▶, wait, ■. `TOTAL_SECONDS` is required
  (the 25-minute capture 1513.9833, the long Recording 9111.5333); `PLAY_MS` sets the length of each play; `FOLD=1` folds the picture away first, which
  is the baseline for how fast the sound comes without frames being made.
- `report.js`, run with `cdp.mjs evalfile`: per sound played, press to audible sound, how late the first new frame came,
  frames drawn a second, gaps over 34 ms; still frames after a click; the picture's memory and ffmpeg runs. Set
  `globalThis.__compact = true` first for one line per play. Run `recorder.js` again to start a fresh recording.
- `cdp.mjs eval "<expression>"`, `cdp.mjs evalfile <script>`, `cdp.mjs drop <path>`: drive the window by hand.

The densest stretches of the owner's Gaming cut on SourceTrack 5 of the 25-minute capture are 289.1, 585.9 and 1016.4 s.

## What passes

The owner's conditions (ADR-0028): no gap over 34 ms between frames while playing, in dense stretches too; the first
new frame with the sound; the sound at most 0.3 s later than with the picture folded; at most 2 GB for the picture.
