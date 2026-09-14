# The window's design direction

Agreed with the owner on 2026-09-14 after a round of questions (what bothers them, what must stay, which mood). This is
the brief for the two drafts (`docs/design/ui-drafts.md`, once they exist) and for the build after the owner has chosen.
Nothing here changes what the window does; it changes how it looks, where the eye lands, and how the window says it is
working.

## What the owner said

- **The window does not show that it is working.** After opening a Recording the audio is read for 2–25 s, and the only
  sign is the grey status line next to *Schneiden* at the very bottom — below the fold of the fixed 820 × 760 window
  (the page is about 1970 px tall with one Recording open). The owner never saw it and asked for something clear, "sogar
  ein ganzes Ladepopup". Chosen: a big progress display where the waveforms will appear, plus a busy mark on the Tab.
  Never a blocking popup — other Tabs stay usable, and reading runs one Recording after another (ADR-0025).
- **The picture sits on the left.** At 450 px high a 16:9 picture is 800 px wide; in a wider column it is left-aligned.
  It goes in the middle.
- **Everything stays where it is**: the order Aufnahme → Tonspuren → Einstellungen → Schneiden → Ergebnis, every word
  on every button, the sliders as sliders, and the waveform's meaning colours.
- **Mood A: calm and dark like the logo.** Not a dense pro-NLE look, not a light and friendly one.
- Window: maximised on first start, then size and position remembered. Standard Windows title bar, dark.
- Top left: the logo tile with the wordmark; the sentence under the old heading goes.
- Empty window: a large drop area "Aufnahme hierher ziehen" with the two open buttons under it.
- Two drafts, same look, different layout: one centred column with a maximum width, or two columns.

## The subject

One person, the owner, sits in front of this window for a long time: they open a multi-hour OBS capture, watch the
picture, listen to a SourceTrack, move three sliders, press *Schneiden*, save. The window's job is to make the cut
visible and the waiting honest. The material of this world is the waveform and the cut through it — which is exactly
what the logo draws: lilac bars and a dashed splice line on a navy tile.

## Tokens

### Colour

All from the logo's readme (`accent #9184d9`, `light #b5abfc`, `ground #161826 / #1b1d2c`, `text #e9e9ed`), the rest
derived so that nothing neutral-grey sits on the navy.

| token | value | used for |
|---|---|---|
| `--ground` | `#161826` | the window |
| `--raised` | `#1b1d2c` | panels: the viewed Tab, result box, notes, dialogs |
| `--well` | `#11121c` | sunken fields: selects, the name input, the ground behind a waveform before any cut |
| `--line` | `#2a2e48` | hairlines and borders |
| `--text` | `#e9e9ed` | text |
| `--muted` | `#9c9fb6` | secondary text, eyebrows, facts (6.5 : 1 on the ground) |
| `--accent` | `#9184d9` | everything you can act on: primary buttons, slider fill, links, the playing ▶, the busy bars |
| `--accent-bright` | `#b5abfc` | hover, focus rings, the large mark on the empty window |
| `--bad` | `#f08a7a` | refusals and red notes, as today |

Contrast: lilac on the ground and navy text on a lilac button are both about 5.2 : 1.

**The waveform keeps its meaning colours unchanged**, because the owner has learnt them: kept `#7fd6b4` on `#1f3a2e`,
removed `#7a4046` on `#2a1416`, held `#5aa9e6`, Join `#e8b04a`, Playhead `#e8eaed` ("der weiße Strich" in the window's
own words). Lilac means "you can act here"; green and red mean "what the cut does". The two never share a job. The only
waveform tint allowed: the *plain* waveform before any cut (`#8b96a3` on `#1c1f25`, neutral grey) may move to `--muted`
on `--well` so it sits on the navy — to be shown to the owner in the drafts, not decided here.

### Type

One family, three optical sizes, no second face and no bundled web font: the window's Content-Security-Policy is
`default-src 'self'`, Windows 11 ships Segoe UI Variable, and calm was the brief. The characterful face in this window
is the wordmark itself — Inter 500, taken from the logo folder as an image (`smarttrim-lockup-dark`; its SVG holds live
text, so use the PNG or convert the text to paths first).

| role | face | size / weight | where |
|---|---|---|---|
| eyebrow | Segoe UI Variable Small | 11 px, 600, uppercase, +0.08 em | the three section labels — they are the workflow order, so they stay |
| caption | Segoe UI Variable Small | 12–13 px, 400 | slider explanations, facts under the Recording's name, hints |
| body | Segoe UI Variable Text | 14 px, 400 / 600 | everything else, line height 1.5 |
| lead | Segoe UI Variable Display | 16–17 px, 600 | the result sentence ("Von 25 Min bleiben 20 Min übrig …"), dialog titles |

Every number that can change — seconds, dB, minutes — is set with tabular figures, as today. Hints are capped at
about 70 characters a line so they do not run across a maximised window.

### Space and shape

A 4 px base: 8 / 12 / 16 / 24 / 32. Sections keep 24 px above and below and a hairline between them. Radius 8 on
controls, 10 on panels, 6 on waveform canvases, 16 on the empty window's drop area. The large mark on the empty window
keeps the tile's own corner radius. No shadows except under the dialog, no gradients, no glow.

## Layout

Both drafts share a full-width top: the mark and wordmark on the left, the two open buttons on the right of the same
row (they add Tabs, so they belong to the window, not to a Tab), the Tab strip under it. The open buttons moving from
under the heading into the header row is the one thing that changes place; the owner sees it in the drafts.

**Draft 1 — one column** (`max-width: 1040px`, centred; the ground fills the rest):

```
┌──────────────────────────────────────────────────────────────────────┐
│ [▮▮] SmartTrim                     [Aufnahmen wählen …] [Projekt öffnen …]
│ ┌ capture-25min.mp4 × ┐┌ Part2.mp4 × ┐                          │
├──────────────────────────────────────────────────────────────────────┤
│           ┌──────────────── 1040 px ────────────────┐                │
│           │ AUFNAHME  capture-25min.mp4         │                │
│           │ 25 Min · 1920×1080 · 60 Bilder/s · 6 …   │                │
│           │ TONSPUREN                                │                │
│           │        ┌──── picture, centred ────┐      │                │
│           │        └──────────────────────────┘      │                │
│           │ [overview strip]  Ausschnitt ──── 25 Min │                │
│           │ rows with waveforms …                    │                │
│           │ EINSTELLUNGEN …                          │                │
│           │ [Schneiden]  status                      │                │
│           │ ┌ result ┐                               │                │
│           └──────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────────┘
```

**Draft 2 — two columns** from 1200 px up; below that it stacks back into draft 1's order:

```
┌──────────────────────────────────────────────┬───────────────────────┐
│ [▮▮] SmartTrim                     [Aufnahmen wählen …] [Projekt öffnen …]
│ tabs …                                                               │
├──────────────────────────────────────────────┬───────────────────────┤
│ AUFNAHME  name · facts                       │ EINSTELLUNGEN         │
│ TONSPUREN                                    │ Voreinstellung …      │
│        ┌──── picture, centred ────┐          │ Lautstärke ab ──────  │
│        └──────────────────────────┘          │ Luft an den … ──────  │
│ [overview strip]  Ausschnitt ──────── 25 Min │ Pausen entfernen ───  │
│ rows with waveforms, full width …            │ Andere Tabs …         │
│ Anfang festhalten · Ende festhalten          │ [Schneiden]  status   │
│                                              │ ┌ result ┐            │
│                                              │ [Alle Premiere-…]     │
│                                              │ ← 400 px, sticky      │
└──────────────────────────────────────────────┴───────────────────────┘
```

The right column is 400 px and sticks to the top while the left scrolls, so *Schneiden*, the sliders and the result
are always in view next to the waveform they change. The left column gets the whole remaining width for the picture
and the waveforms.

## The signature: the sound arrives

The one place the window is allowed to be memorable is the wait the owner complained about. While SmartTrim reads a
Recording, the space where the waveforms will appear holds the logo's own motif — rows of lilac bars in the mark's
rhythm (short, tall, middle, tall, short, repeated across the width) — and the bars fill in from left to right as the
SourceTracks are read:

```
┌──────────────────────────────────────────────────────────────┐
│ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯ │  filled = read, ghost = still to come
│ Liest den Ton der Tonspuren … 2 von 4 fertig                  │
└──────────────────────────────────────────────────────────────┘
```

- Filled bars are `--accent`, pending bars `--line`. The bars are a pattern, never real audio: nothing may be read
  into them.
- The text under the bars is the existing status text, moved up from the bottom: "Prüft die Tonspuren …", "Liest den
  Ton der Tonspuren … 2 von 4 fertig", "Liest den Ton für die Wellenform …", "Liest die Aufnahme …". Red refusals stay
  next to *Schneiden*, as today.
- **The same block appears where the result will appear while a cut runs** — under *Schneiden*, in place of the result
  box — with no number, since cutting reports no steps: a soft lilac pulse travels along the ghost bars. The rule
  behind both: the wait is shown where its outcome will land.
- **The Tab shows it too**: three tiny bars in the mark's rhythm before the Tab's name, rising and falling in turn, on
  every Tab whose Recording is being read or cut — not only the viewed one, since reading runs in the background across
  Tabs. The amber dot of a passed-over Tab (ADR-0026) stays as it is.
- With `prefers-reduced-motion`, the pulse and the Tab's bars stand still; the fill and the text carry the meaning alone.

What is *not* shown this way, at the owner's word: the wait after ▶ before the sound (under a second), the still frame
after a click (under half a second), and the first-start download, which already disables the window with a percentage.

## The empty window

The first thing anyone sees. Today: one grey sentence. Now the drop area the window could always handle but never
announced:

```
┌───────────────── dashed --accent, radius 16, --raised inside ─────────────────┐
│                                                                                │
│                                  [mark, 96 px]                                 │
│                            Aufnahme hierher ziehen                             │
│                    eine Aufnahme, mehrere, oder ein ganzer Ordner              │
│                                                                                │
│                   [Aufnahmen wählen …]   [Projekt öffnen …]                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

It fills the space under the header, and goes as soon as a Tab exists. While a file is dragged over the window the
existing overlay (`#dropOverlay`, "Hier ablegen") still appears; its dashed line turns `--accent-bright`. The three
sections stay under the drop area, greyed as today, so the shape of the window does not jump when the first Recording
opens.

## Controls

- **Buttons**: `--raised` with a `--line` border; hover lifts the border to `--accent`; the primary button (*Schneiden*,
  *Premiere-Datei speichern …*, the dialogs' first choice) is `--accent` with `--ground` text, `--accent-bright` on
  hover. Disabled at 40 % opacity, as today. Focus: a 2 px `--accent-bright` ring, 2 px out.
- **Sliders**: native range inputs with `accent-color: var(--accent)` — Chromium fills the track up to the thumb in that
  colour, which is enough and costs nothing.
- **Selects, the preset name field, checkboxes**: `--well` inside a `--line` border; checkboxes take the accent.
- **Links** (`button.link`: "Bild ausblenden", "1 leere Tonspur zeigen …", "entfernen"): `--accent`, underlined, as
  today.
- **▶**: the round button as today; playing turns its ring and glyph `--accent`.
- **Tabs**: the viewed Tab is `--raised` with a 2 px `--accent` top edge; the others `--muted` on the ground. The × turns
  `--bad` on hover, as today.
- **The picture**: centred, at most 450 px high, `--line` border, radius 8; "Bild ausblenden" right-aligned under it.
- **Panels** (result, notes, dialogs): `--raised`, `--line` border, radius 10. The result sentence is the lead size.
- **Hold buttons**: the blue border stays (`#2f5f86`) — it is the held colour's own family.
- **Motion**: 150 ms on colour changes; nothing else moves except the signature.

## The window itself (main process)

- First start maximised; afterwards the bounds are saved to `window.json` in `app.getPath("userData")`, beside
  `presets.json` (ADR-0018), and restored if they still lie on a connected display.
- `nativeTheme.themeSource = "dark"` so the Windows title bar is dark; `backgroundColor` of the `BrowserWindow` becomes
  `--ground` so nothing flashes before the page paints.

## What must not change

- The order of everything, every text on buttons, labels, hints and dialogs, the sliders' ranges and defaults.
- The waveform's meaning colours and the white Playhead.
- The rules of the window that ADR-0018 and the project memory record: an element with a `display` of its own needs
  its own `[hidden] { display: none }` rule, or `hidden` does nothing; no `confirm()` / `alert()`, ever — questions are
  in-window; the waveform canvases are reused across redraws, never rebuilt.
- Behaviour. This is CSS, HTML structure and a few new elements (the progress block, the Tab mark, the drop area); the
  only behaviour added is the window remembering its bounds and the status text reaching the new places.

## Against the defaults

Checked against the three looks generated design falls into: cream and terracotta (no), broadsheet hairlines and zero
radius (no), and near-black with one acid accent — the closest. This window is navy, not black, and its accent is a
soft lilac, both prescribed by the logo; what keeps it from the generic dark dashboard is that panels are rare (three),
nothing glows or fades, and the memorable element is drawn from the subject — the waveform arriving — not from a
gradient. Two ideas were dropped as decoration: numbering the three sections 01 / 02 / 03 (the order is real, but the
owner knows it), and a monospace face for the numbers (technical, not calm).

## What came of it

Both drafts were built on branch `prototype/ui-drafts` (`docs/design/ui-drafts.md` there) and compared by the owner
in the real window on 2026-09-14. **They chose two columns.** What was built on main from it, and what was surprising
on the way, is ADR-0029.

## For the drafts

- Branch `prototype/ui-drafts`, never merged: the two drafts differ only in the layout block (a centred max-width
  column against a grid with a sticky right column). A switch at the top right of the header, remembered in
  `localStorage` (`smarttrim.draft`), so the owner can compare them with a real Recording in the real window.
- The drafts are judged in the owner's window at their sizes: 820 × 760 as they use it today, and maximised on the
  2560 × 1080 screen.
- Screenshots of the window before the change are in the session's scratchpad (`shots/01-empty.png` to
  `04-cut-bottom.png`, 2026-09-14). They show the owner's face and chat — keep them local.
