# The window follows the logo, and shows a wait where its outcome will land

On 2026-09-14 the owner asked to make the window nicer. Grilled first: what bothered them was not the look but that
the window never showed it was working — after opening a Recording, the SourceTracks are read for 2–25 s and the only
sign was the grey status line next to *Schneiden*, below the fold of the fixed 820 × 760 window — and that the picture
sat on the left. Everything else was to stay where it is. The mood they chose: calm and dark like their logo.

The direction is written down in `docs/design/ui-direction.md` (tokens, type, both layouts, the signature). Two
layouts were built as a throwaway prototype on branch `prototype/ui-drafts` (`docs/design/ui-drafts.md` there), switched
in the real window, and compared by the owner with real Recordings at 820 × 760 and maximised on their 2560 × 1080
screen. **They chose two columns.** This ADR records what was decided and what was surprising on the way.

## Decided

- **The palette is the logo's** (`#161826` ground, `#1b1d2c` raised, `#9184d9` accent, `#b5abfc` bright, `#e9e9ed`
  text), the rest derived so nothing neutral-grey sits on the navy. Lilac means "you can act here"; the waveform's
  meaning colours — kept, removed, held, Join, the white Playhead — stay exactly as the owner learnt them. Only the
  plain waveform before any cut moved from neutral grey to the window's sunken and muted tones.
- **Two columns from 1200 px.** Left: the Recording, the picture (centred, at most 450 px high), the overview strip,
  the SourceTrack rows with their waveforms, the held stretches. Right, 400 px, sticky while the left scrolls: the
  settings, *Schneiden*, the result, saving all. Below 1200 px everything stacks into the old order, centred with a
  maximum width. The order of everything, every word and every slider is unchanged.
- **A wait is shown where its outcome will land** (`waitOf` in `src/app/waiting.ts`, tested). While a Tab's
  SourceTracks are scanned or read, rows of bars in the logo's rhythm stand where the overview strip and the waveforms
  will appear, with the job's status line under them; while a cut runs, the same bars stand under *Schneiden* where
  the result box will appear. Refusals stay a red line next to *Schneiden* and are never a wait. Every Tab being read
  or cut in the background shows three small bars before its name. The wait after ▶, the still frame after a click
  and the first-start download are not shown this way, at the owner's word.
- **The empty window is a drop area** — "Aufnahme hierher ziehen" with the two open buttons under it — since dropping
  files was possible for a day without the window saying so. While it is on screen the header's pair of open buttons
  is hidden, so one pair is on screen at a time; the old sentence under *Aufnahme* shrank to "Noch keine Aufnahme
  offen.", since the drop area now says the rest. Both are decisions of this change, not of the direction.
- **The header** carries the logo tile and the wordmark on the left and the two open buttons on the right; they add
  Tabs, so they belong to the window, not to a Tab. The Tab strip runs under it. The sentence explaining SmartTrim went.
- **The window opens maximised the first time** and afterwards where it was closed (`placementOf` in
  `src/app/windowPlacement.ts`, tested), as long as enough of it still lies on a connected display; the bounds live in
  `window.json` beside `presets.json` (ADR-0018). The Windows title bar is dark (`nativeTheme.themeSource = "dark"`).

## Surprising on the way

- **The read count stands still.** All SourceTracks of a Recording are read at once, one ffmpeg each (ADR-0011), so
  "2 von 4 fertig" reads "0 von 4" for almost the whole 25 s of the long Recording and jumps at the end. The bars therefore do not
  rely on the count: the unlit ones carry a travelling pulse, so the wait never looks stuck.
- **An inlined image is blocked.** The window's Content-Security-Policy is `default-src 'self'`; Vite inlines assets
  under 4 kB as `data:` URIs, which that policy refuses without a word. `assetsInlineLimit: 0` in
  `electron.vite.config.ts` keeps the logo and the wordmark as files.
- **The wordmark is an image.** The logo's lockup SVG holds live text in Inter, which the owner's machine need not
  have; the wordmark was cropped out of the lockup PNG (`src/renderer/assets/wordmark.png`, 460 × 88) and is drawn 19 px
  high. Inter itself is not bundled: the policy allows no web font and the brief was calm — Segoe UI Variable, which
  Windows ships, does the rest.
- **Electron's DevTools endpoint cannot move the window.** `Browser.getWindowForTarget` and `setWindowBounds` are not
  there, and `Emulation.setDeviceMetricsOverride` does not reflow the page. The prototype was checked at 820 × 760 by
  moving its own window through user32 (`ShowWindow`, `MoveWindow`), a script kept in that session's scratchpad.
- **A force-killed window remembers nothing**: the `close` handler that writes `window.json` never runs. A test start
  therefore always opens maximised.
- **The bars are made when shown, not at load**: hidden, the block has no width, and their number follows the width
  (4 px bars 3 px apart). A resize while a wait is shown redraws the status, which remakes them.

## What a review found

A two-axis review of the first build (the repo's standards, and the direction) on 2026-09-14, fixed the same day:

- **The bars swallowed any status line.** While a read ran in the background, "Projekt gespeichert: …" or "Plant neu …"
  went under the bars and the status line was blanked. `waitOf` now takes whether the line is the job's own; other news
  stays next to *Schneiden*, and the bars fall back to what the job does ("Liest den Ton der Tonspuren …").
- **A stale line under the cut's bars.** `cutTab` drew with `working` before it set its own line, so "Einstellung
  geändert – noch einmal schneiden." stood under the bars for the span of a pending replan, and the old result box
  stayed under them. The result and the line are cleared before the first draw now.
- **Long Tab names lost their "…"**: the label had become a flex container to hold the busy mark, and `text-overflow`
  applies only to blocks. The label is a block again; the mark sits inline.
- **Focus dropped after opening from the drop area**: the area hid with the focus still on its button — the pattern
  ADR-0018 forbids. The header's matching button, on screen again by then, takes the focus.
- The settings got 368 px, not 400 (the column's padding was inside the track); the dialogs' radius was 12, not the
  panels' 10. The two places a wait is shown are one record now, not two copies of the same lines.
- Left as decided, and written into "Decided" above: the header's open buttons hidden while the drop area is on
  screen; the shortened sentence under *Aufnahme*; the drop area a box of its own height rather than filling the
  space under the header.

## Tested, and not

- `src/app/waiting.test.ts`: nothing running is no wait; a read fills by SourceTracks done; a scan, a project's audio
  and a single SourceTrack have no count; a cut shows at the result and wins over a read; a refusal is never a wait.
- `src/app/windowPlacement.test.ts`: the first start is maximised; a saved window on a display still there opens
  there, maximised again if it was; a display that is gone or a window hanging off every display hands the placing to
  the system; the file round-trips and anything else reads as nothing saved.
- The HTML and CSS, the bars on screen, the busy mark, the drop area, the header and the two columns are drawing,
  untested like the rest of the window (ADR-0012). Checked over the Chrome DevTools protocol on the built app with the
  25-minute capture and the long Recording from the external drive: the bars above the rows for the whole read with the busy mark on
  the Tab, then gone; the bars under *Schneiden* for the length of a cut, then the result in their place; both columns at
  2560 × 1009 and the stacked order at 804 × 721; the picture centred; the drop area with working buttons on the empty
  window. The prototype's screenshots show the owner's face and stay local.
