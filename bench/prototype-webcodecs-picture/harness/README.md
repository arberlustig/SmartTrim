# PROTOTYPE harness, throw away

Scripts from the 2026-09-13 diagnosis of the stuttering picture (ADR-0027). Not product code.

- `cdp.mjs`: drives a running SmartTrim over the DevTools protocol on port 9223 (`eval`, `evalfile`, `drop <paths>`, `front`, `shot`).
  Start the app with `node_modules/electron/dist/electron.exe . --remote-debugging-port=9223 --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`
  (a covered window is reported hidden and gets no animation frames).
- `smooth.js`: the acceptance loop. Counts frames the picture really presented (`requestVideoFrameCallback` metadata.presentedFrames, not callbacks) and gaps over 50 ms, at the densest stretches. It used the removed debug hook `window.__debug9b1d.sound()` for the sound position and the two `<video>` elements; adapt both to the WebCodecs picture.
- `lagloop.js`, `mediawatch.mjs`: first-round loop (seek storm) and a Chromium media log reader.
- `densejoins.ts`, `keptjson.ts`: the owner's the 25-minute capture cut (SourceTrack 5, Gaming) — densest 8 s stretches (289.1 s, 585.9 s, 1016.4 s) and `bench/out/the 25-minute capture-owner-kept.json` for the prototype. Run with `node` from anywhere; paths are absolute.
