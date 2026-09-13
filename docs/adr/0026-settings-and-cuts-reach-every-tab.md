# Settings, cuts and Premiere files reach every Tab at once

With several Recordings open in Tabs (ADR-0025), three buttons act on all of them:

- "Für alle übernehmen" copies the settings of the Tab on screen into every other Tab.
- "Alle schneiden" cuts every Tab, one after another, each on its own settings. It only cuts: each Tab's waveforms and
  numbers show its new cut, and nothing is written.
- "Alle Premiere-Dateien speichern", at the bottom of the window, writes the Premiere file of every Tab whose cut is
  current beside its Recording, without a dialog.

The owner asked for the first two on 2026-09-13 as the third of four agreed steps. What was agreed:

- **"Für alle übernehmen" asks first**, in the window: "Haben alle Aufnahmen dieselbe Tonspur-Aufteilung?", answered
  with "Nur Regler" or "Regler und Tonspur-Rollen" (or Abbrechen).
- **A Recording with another number of SourceTracks gets the sliders only**, and a note says so.
- **Held stretches are never copied.** They are moments of one Recording.
- **"Alle schneiden" cuts each Tab with its own settings as they stand**, one Tab after another. A Tab with no SourceTrack
  on "danach schneiden" is passed over and marked, and the window sums up: "8 geschnitten, 2 übersprungen".
- **Files are written beside each Recording without asking, never over an existing file** (`Name.xml`, else
  `Name (2).xml`). The save dialog of a single Tab stays.

Proposed with the seams and approved together with them ("Passt, bau es."):

- **The Premiere ticks come with the roles.** Which SourceTrack goes to Premiere belongs to the same OBS layout as which one
  carries the voice.
- **A role that lands on a SourceTrack the Tab hides as an EmptyTrack shows that Tab's EmptyTracks.** Otherwise a
  SourceTrack out of sight would decide the cut.
- **A cut that already matches its settings is not cut again.**
- **The buttons appear from two Tabs on.** While any Tab cuts, taking over and the two all-Tab buttons are locked; while
  an all-Tab button runs, Schneiden is locked too. A Tab that fails does not stop the others: it is listed in red with its
  reason.

## Cutting and saving are two buttons

The first build had "Alle schneiden" write each Tab's `Name.xml` and `Name.smarttrim` straight after its cut, as agreed.
The owner tried it the same day and rejected that: pressing "Alle schneiden" should stay on the cutting level — update
every waveform after its own sliders, so the cuts can be looked at and adjusted — and saving should be a button of its
own at the end of the window. Writing files from a button called "schneiden" made no sense to them.

So "Alle schneiden" writes nothing, and ends with a note pointing at "Alle Premiere-Dateien speichern". That button
**never cuts**: a Tab without a cut, or whose settings its cut no longer matches, is passed over as not cut yet, so no
file is ever written for an edit other than the one on screen. It writes **the Premiere file only**, like the single
Tab's "Premiere-Datei speichern"; a project stays with the single Tab's "Projekt speichern" and with closing a Tab
(ADR-0025).

## Where the rules live

`src/app/allTabs.ts` holds the decisions as plain functions of a `CutSession`, so they are tested without Electron:

- `settingsCopied(from, to, "sliders" | "slidersAndRoles")` returns the other Tab's new session and whether the roles
  were asked for and left out. The five sliders and `selectedPreset` always come; `listenTo`, `contentSourceTracks` and
  `exportSourceTracks` only with matching SourceTrack counts; `lockedRanges` never. The receiving Tab's own cut is then
  handled as if the sliders had been moved by hand: replanned, decided again, or no longer offered (`afterSettingChange`).
- `cuttingAllDoes(session, hasCut)` answers `cut`, `nothing` or `skipNoVoice`. What goes to Premiere does not matter for
  cutting.
- `savingAllDoes(session, hasCut)` answers `save`, `skipNotCut` or `skipNoExport`.
- Both take `hasCut` from the window rather than reading `plannedWith`: a cut refused by the main process leaves the
  settings it was asked with in place, and `redoNeeded` would call that nothing to do.

`TabStore.savePremiereBeside(tabId, exportSourceTracks)` writes through `freePathBeside(recording, ".xml")`, and IPC
`cut:saveBeside` carries it. The two loops live in the window (`cutAllTabs`, `saveAllTabs`): each reads a Tab's settings
at that Tab's turn, not when the button was pressed, and `cutAllTabs` reuses the Schneiden button's own `cutTab`.

## Tested, and not

- `src/app/allTabs.test.ts`: taking over the sliders brings the Preset and never the roles or held stretches; with the
  roles it brings the Premiere ticks and shows hidden EmptyTracks when a role lands on one (and only then); another
  SourceTrack count gets the sliders and `rolesLeftOut`; what cutting all does with a fresh, a current, a changed, a
  refused, a voiceless and an unexported Tab; what saving all does with a current, an uncut, a changed, a refused and an
  unexported one.
- `src/app/tabStore.test.ts`, real ffmpeg: a Tab writes `Part1 (2).xml` beside a foreign `Part1.xml` and leaves it alone,
  then `Part1 (3).xml`, and nothing else appears in the folder; the XML equals `exportFcp7Xml` of a fresh `runCut` of the
  same Recording.
- The buttons, the question, the notes and the loops are untested like the rest of the window (ADR-0012). Checked over
  the Chrome DevTools protocol on the built app with three generated Recordings (two with two SourceTracks, one with
  one): taking over the roles gave PartB PartA's roles and Luft and showed its EmptyTrack, Handy got Luft only with its
  note, focus started on Abbrechen. "Alle Premiere-Dateien speichern" stayed disabled before any cut. "Alle schneiden"
  cut PartA and PartB, drew their results, marked Handy, summed up "2 geschnitten, 1 übersprungen" and wrote no file.
  "Alle Premiere-Dateien speichern" then wrote `PartA.xml` and `PartB (2).xml` (a foreign `PartB.xml` untouched), no
  project, and passed Handy over. Real Recordings, a failing cut and a Premiere import of files written this way need
  the owner.
