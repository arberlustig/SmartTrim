# The two drafts of the window (prototype)

Throwaway, on branch `prototype/ui-drafts` and never merged: the window restyled after `ui-direction.md`, with the two
agreed layouts switchable at the top right ("Entwurf · 1 Spalte / 2 Spalten", remembered in `localStorage` under
`smarttrim.draft`). The question they answer: **one centred column, or two columns with the settings kept in view on
the right?** The owner compares them in the real window with a real Recording, at 820 × 760 as they use it and
maximised on their 2560 × 1080 screen.

## Running it

```
git checkout prototype/ui-drafts
npm run dev
```

The window opens maximised the first time (no `window.json` yet in `%APPDATA%\SmartTrim`) and afterwards where it was
closed. The installed SmartTrim shares that folder; close it first or accept Chromium's cache warnings.

## What is in it

- `src/renderer/index.html`: the tokens and every rule from the direction; a header with the logo tile and the wordmark
  (`assets/`, cropped from the owner's lockup PNG), the open buttons on its right, the Tab strip under it; the drop area
  on the empty window; the picture centred; the two layouts under `html[data-draft]`.
- `src/renderer/renderer.ts`: `drawStatus` shows a wait where its outcome will land — the bars above the SourceTracks
  while reading, under *Schneiden* while cutting — and clears the status line meanwhile; the busy mark on a Tab; the
  drop area's own buttons forward to the header's; the plain waveform tinted to the navy (`PLAIN_BAND`, `PLAIN_WAVE`);
  the draft switch.
- `src/main/index.ts`: maximised on first start, bounds remembered in `window.json`, `nativeTheme` dark so the title bar
  is, window ground `#161826`.
- `electron.vite.config.ts`: `assetsInlineLimit: 0`, because the Content-Security-Policy would block an inlined image.

## Checked over CDP (2026-09-14, built app on port 9223, `bench/picture-acceptance/cdp.mjs`)

- Empty window, both drafts, maximised: the drop area spans the width; its two buttons work; the header's pair is
  hidden meanwhile.
- the long Recording from the external drive: the bars appear above the rows the moment the Tab opens, the text under them reads
  "Liest den Ton der Tonspuren … 0 von 4 fertig" for the whole 25 s — all SourceTracks are read at once (ADR-0011), so
  the count only moves at the end; that is why the unlit bars pulse. The block goes when the read ends. The Tab shows
  the busy mark while it reads.
- the 25-minute capture, SourceTrack 5, cut: the bars under *Schneiden* for the length of the cut, then the result box in their place.
- Both drafts at 2560 × 1009 and at 804 × 721 (820 × 760 outside), top, middle and bottom. Draft 2 stacks into draft 1's
  order below 1200 px, as intended. Screenshots in the session scratchpad `shots/` (owner's face on them — local only).
- Right after switching drafts one screenshot showed stray slider numbers in the left column; the next did not, and no
  element was there (`elementFromPoint`). A paint artefact of the switch, not the layout.

## Prototype shortcuts, to be done properly in the build

- The saved window bounds are not checked against the connected displays.
- What the bars say while cutting is guessed from the status text; the build should carry a proper "busy" state.
- Bars are remade on every resize while shown, by counting the lit ones — fine for a prototype, clumsy for the build.
- Nothing here is tested (window glue, ADR-0012); the build's behaviour changes (bounds, busy state) deserve tests
  where they can have them.

## Verdict

_Open until the owner has compared them._
