# The app window: electron-vite, an ESM preload, and the CutPlan staying in the main process

The window is built with electron-vite: it compiles the main process, the preload script and the renderer separately
and leaves everything in `dependencies` — onnxruntime-node above all, which carries native binaries — outside the
bundle. `npm run dev` starts it; `npm run build` writes `out/`.

Three decisions in it are easy to undo by accident.

## The preload script is an ES module, so the window must run with `sandbox: false`

`package.json` says `"type": "module"`, so electron-vite emits `out/preload/index.mjs`. Electron loads an ESM preload
only outside the sandbox. With `sandbox: true` the preload never runs, `window.smarttrim` stays undefined and every
button in the window silently does nothing — no error anywhere. The window still never reaches Node: the bridge
exposes four functions (choose a Recording, cut, save, show in Explorer) and nothing else.

## The CutPlan never crosses into the window

`cut:run` answers with a CutSummary — seconds kept, seconds removed, number of KeepSegments — while the CutPlan
itself waits in the main process until `cut:save` writes it. At the owner's settings a plan holds around 2000
KeepSegments and becomes tens of megabytes of XML; the window has nothing to do with any of it. Saving therefore
works from the plan that was analysed, and a changed slider makes the window drop the result on screen instead of
offering a file for settings the user has since changed.

## Every answer is a value, not an exception

The main process wraps each handler so a refusal arrives as `{ ok: false, message }`. An IPC exception would reach
the window as "Error invoking remote method ..." with the real sentence buried inside; this way the message that
`analyseRecording`, `probeRecording` or `saveCutPlan` wrote is what the user reads.

## Consequences

The window offers only the loudness decision the owner chose (ADR-0003); the voice decision stays in
`analyseRecording` for a Preset to reach later. The slider ranges in `src/app/cutSession.ts` are judgement, not
measurement — they live next to the clamping so the sliders and the rules cannot disagree.

The Electron glue itself has no tests: the behaviour sits in `src/app/cutSession.ts` (what the window remembers, and
when Schneiden may be pressed) and `src/app/runCut.ts` (the job behind the button, and saving), both tested. The glue
was verified once by attaching to the running window over the Chrome DevTools protocol: the bridge exposed its four
functions, a real cut through `cut:run` returned the same summary as the test, and a bad request came back as a
message. Dialogs can only be checked by clicking them.
