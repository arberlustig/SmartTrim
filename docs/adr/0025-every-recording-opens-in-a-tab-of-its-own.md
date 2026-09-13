# Every Recording opens in a Tab of its own

The window holds several Recordings at once, one per Tab (CONTEXT.md). Each Tab is as independent as a window of its
own: its own sliders and roles, its own held stretches, its own cut and waveforms, its own Playhead. Both dialogs
take several files, and dropping several files or a folder opens each file in a Tab.

The owner asked for it on 2026-09-13 as the second of four agreed steps (dropping one file — ADR-0024 —, Tabs,
cutting every Tab at once, a video preview). What was agreed:

- **"Aufnahmen wählen" adds Tabs** and takes several files; "Projekt öffnen" opens a Tab too.
- **A folder opens the files directly inside it**, never those in folders within, in natural order (`Part2` before
  `Part10`). Files that will not open are listed with their reason; the rest still open.
- **A Recording already open is shown, not opened a second time.** A project of it is not loaded either — its Tab's
  work would be lost — and a sentence says so.
- **× closes a Tab**, after an in-window question when it holds a held stretch no saved project holds. Only a project
  counts as saved: SmartTrim cannot open a Premiere file again.
- **One sound at a time.** Showing another Tab stops it.
- **Every Tab's SourceTracks are read in the background, one Recording after another**, the Tab on screen first. The
  owner chose sequential over parallel.
- **Tabs are not restored** when SmartTrim starts again.
- Proposed with the seams and not objected to: SmartTrim's own `.xml` files inside a dropped folder are passed over
  without a word — once "Alle schneiden" writes one next to every Recording, a folder dropped again would otherwise
  list a refusal per Recording — and other Tabs stay usable while one cuts.

## The main process keeps each Tab apart

Before Tabs, the main process held one Recording in module variables: the chosen Recording, what was read of its
SourceTracks, its cut. What was read is matched to a request **by position**, and positions repeat from Recording to
Recording — SourceTrack 1 of one capture is not SourceTrack 1 of the next. Kept side by side in those variables, one
Tab's cut would silently decide from another Tab's levels.

`newTabStore(tools)` in `src/app/tabStore.ts` now holds all of it per Tab, and every IPC call names its Tab. The
handlers in `src/main/index.ts` only pass requests on and open dialogs. Two rules live in the store:

- **A Recording has at most one Tab.** `open` answers with the Tab it already has, comparing paths the way Windows does
  (`c:/aufnahmen/LONG-RECORDING.MP4` is `C:\Aufnahmen\long-recording.mp4`), for a project of it as much as for the Recording itself.
- **Whatever arrives for a closed Tab is refused**, checked after every wait (`stillOpen`). This replaces the old
  "another Recording was chosen" guard: nothing is ever replaced in place now, a Tab is only ever closed.

## Opening several files

`openFiles(paths, ffprobePath)` in `src/app/openFile.ts` expands folders and opens each file with `openFile`. A
refusal does not stop the others. Within one batch, **a project wins over its bare Recording** and takes the place of
whichever of the two came first: a folder holding `Part2.mp4` and `Part2.smarttrim` opens the project, where the
Recording stood. Natural order is `Intl.Collator` with `numeric: true`, the order Explorer shows.

## What runs in the background, and in which order

`nextBackgroundJob(tabs, viewed)` in `src/app/tabs.ts` decides the one job that runs next: scanning a Recording,
reading its SourceTracks, or reading a reopened project's audio. **The Tab on screen goes first, scan and read**, since
that is where the user waits. **Then every other Tab is scanned before any of them is read**: a scan takes a second
and hides the EmptyTracks, a read takes up to half a minute each. The reads then go from the left.

A refused job **stalls its Tab** (`jobRefused`) — asked again at once, the same request would be refused again, one
ffmpeg on a 23 GB file per turn — until the user gives one of its SourceTracks a role (`roleGiven`), which asks for
that SourceTrack only.

Checked on the running app over the Chrome DevTools protocol with the 25-minute capture (3.9 GB, internal SSD) and the long Recording (23.5 GB,
external drive) dropped together: the 25-minute capture was scanned and read first, the long Recording scanned only once the 25-minute capture's Tab was closed during
its read. **The cost that check showed:** closing a Tab does not stop its ffmpeg, and the next job waits until it has
finished — 2 s for the 25-minute capture, up to the ~25 s a whole read of the long Recording takes. Stopping ffmpeg on close would remove it; it was not
built.

## A refusal says what went wrong, and the core of what was reported

The first version listed a refused file with the raw error: `ffprobe could not read C:\…\notiz.txt: C:\…\notiz.txt:
Invalid data found when processing input`. The owner, used to C# exceptions, asked for a message that carries the core
of the error instead of where it happened. So a refusal is now a `FileRefused` with a **kind** and a **detail**:

- The kind says what the user has to know — no Recording at all, a Recording SmartTrim cannot cut, a broken project, a
  project whose Recording is gone, one whose Recording changed — and the window words it in German.
- The detail is the core of the report without the path it was wrapped in: ffprobe's last line
  (`Invalid data found when processing input`) or the refusal's own sentence. The one path kept is where a missing
  Recording was looked for, because that is what the user has to go and find.
- A failed ffprobe run and a Recording the probe read and refused are told apart by whether the probe's error carries a
  cause (it wraps only the failed run), not by matching its wording.

The window shows them in a box under the buttons, headed "N Dateien ließen sich nicht öffnen", one file per line with
the detail beneath in small grey type; news such as "ist schon offen" gets a grey dot instead of a red one. × dismisses
the box.

## The close question is a dialog

The first version asked in a plain row under the Tabs. The owner asked for it to look like a question worth stopping
for. It is now a dialog over the dimmed window — still inside it, never `confirm()` (ADR-0018) — naming the Tab, listing
the held stretches that would be lost (up to five, then "und N weitere"), with Windows' three answers: "Speichern und
schließen" (only offered once there is a cut, since a project holds what the analysis found), "Nicht speichern" and
"Abbrechen". Esc and a click beside the dialog cancel. Focus starts on "Abbrechen", so a stray Enter throws nothing
away. Asking about a Tab first puts it on screen. If saving fails the dialog closes, so the reason in the Tab's status
line can be read.

**"Speichern und schließen" asks nothing.** It first opened the save dialog. On the owner's machine that dialog never
came into view — in the checked app Windows did open it (a visible `#32770` window of SmartTrim's process), so it most
likely opened behind the window or on another screen — and SmartTrim's own dialog sat there with its buttons disabled,
waiting for it. The owner said a save dialog was not needed there at all. So `saveProject` in the TabStore writes
without asking: back into the project the Tab was opened from or last saved to (`projectPath`, set by opening a project
and by every save), else beside the Recording as `Name.smarttrim` — or `Name (2).smarttrim` and on, when a file of that
name is already there (`freePathBeside`), so an older project nobody opened is never written over. That is the rule
agreed for "Alle schneiden" as well. Where it landed is reported in the box under the buttons, since the Tab is gone.
"Projekt speichern" under a finished cut followed the same day: its save dialog did not come into view for the owner
either ("nicht schlimm"), which left the button disabled for good, so it saves the same way and says where in the
status line. No project save dialog is left; the Premiere save dialog, which the owner has used, is unchanged.

## Smaller consequences

- **A new Tab starts on the owner's settings (Gaming)**, not on the sliders of the Tab on screen. Carrying settings
  across is step 3's "Für alle übernehmen".
- `CutSession.lockedRangesSaved` remembers what the last saved or opened project holds; `projectSaved` takes it from the
  choices that were **written**, so a stretch held while the save dialog stood open still counts as unsaved.
  `askBeforeClosing` asks when a held stretch lies inside none of the saved ones.
- The renderer keeps one record per Tab (`OpenTab`: `TabWork` plus its cut, waveforms, zoom, Playhead, status line
  and pending replan). An answer writes into the record of the Tab that asked, never into whichever Tab is on screen
  by then, and is dropped when that Tab has closed.
- Two faults of the old window went with the rewrite: a reopened project's audio read was refused when a replan
  finished while it ran (the guard compared the cut object, which a replan replaces), and a refused replan was asked
  again every 120 ms for ever.

## Tested, and not

- `src/app/openFile.test.ts`, real ffprobe: a folder opens its direct files in natural order and names the file it could
  not open; a Recording and its project side by side open as the project, in the Recording's place; `.xml` inside a
  folder is passed over, one handed over by itself is refused.
- `src/app/tabStore.test.ts`, real ffmpeg: a Recording opened again, however spelled or through its project, is the
  Tab it has; two Recordings read at the same position and cut each give what each gives alone (checked red against a
  store sharing one map of reads); a read finishing after its Tab closed is refused and the Tab takes no more requests.
- `src/app/tabs.test.ts`: which Tab shows after closing; when closing asks; the background order step by step; a
  refused Tab stalls until a role is given.
- The strip, the question row, the messages and the per-Tab drawing are untested like the rest of the window
  (ADR-0012). Checked over the Chrome DevTools protocol on the built app (`electron.exe . --remote-debugging-port=9223`)
  with generated Recordings: a dropped folder gave Part1, Part2, Part10 with `notiz.txt` refused and the `.xml` and
  subfolder passed over; roles, cut and Margin stayed in their Tab; the folder dropped again said "3 Aufnahmen sind
  schon offen."; the project of an open Recording was not loaded and said why; × with a held stretch asked, Abbrechen
  kept the Tab, Schließen showed the right neighbour; the project then opened with its held stretch and closed without
  a question; showing another Tab stopped a playing SourceTrack. Real mouse drags and the multi-select dialogs need
  the owner.
