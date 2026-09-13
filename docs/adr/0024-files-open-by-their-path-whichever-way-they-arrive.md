# Files open by their path, whichever way they arrive

A Recording or a TrimProject can be dropped anywhere on the window, besides being picked in a dialog. Both ways end
in the same place: `openFile(path, ffprobePath)` in `src/app/openFile.ts` opens one file as whatever it is, and
`openInWindow(path)` in the main process makes it the one on screen.

The owner asked for dropping on 2026-09-13, as the first of four agreed steps: dropping one file, then tabs (several
files and whole folders), then cutting every tab at once, then a video preview. A dropped folder is refused until
tabs exist; once they do, each file in it is handed to `openFile` on its own, which is why `openFile` refuses a
folder itself instead of leaving that to the window.

## What a file is, is read off its extension

`.smarttrim`, in any case (`.SmartTrim` is what Explorer shows after a rename), opens as a TrimProject; anything else
goes to the probe, which refuses what it cannot cut with its own reason (MKV, ADR-0009; a text file, "Invalid data").
Reading the content instead would add nothing: the dialogs already sort files by extension, and a project renamed to
`.mp4` is still refused, only with ffprobe's words.

## One way in

The Recording dialog, the project dialog and `file:open` all call `openInWindow`, so letting go of what was read of
the Recording open before (ADR-0020) is written once. A side effect: a project picked under "Alle Dateien" in the
Recording dialog now opens as a project instead of being refused by ffprobe. The window has one `showOpened` for all
three.

## Three things that are easy to get wrong

- **A dropped `File` has no path.** Electron 32 removed `File.path`. Only `webUtils.getPathForFile`, in the preload,
  can still ask, so the bridge exposes `pathOf(file)`; it answers `""` for something that is no file on disk.
- **Chromium opens a dropped file itself, replacing SmartTrim**, unless `dragover` calls `preventDefault`. The window
  does so for every drag that carries files. The main process also refuses any navigation to another URL
  (`will-navigate`), which catches dropped links and whatever else slips past; a reload keeps the URL and passes.
- **`dragenter` and `dragleave` fire for every element the pointer crosses**, so the "Hier ablegen" overlay counts
  their balance to know when the drag has left. The overlay itself takes no pointer events, or it would produce its
  own pairs.

## What a review found

A review on 2026-09-13 found nine points, all fixed the same day. Most were older than dropping, but dropping turns
opening a second file while the first is still being scanned or read into an everyday move.

- **A late scan could put the previous Recording back on screen**, and Schneiden would then have cut that Recording
  from the other one's levels. Every answer that arrives after a file appeared — the scan, reading ahead, a project's
  audio — is now dropped when another file has been put on screen since (`filesShown` in the window). `recording:scan`
  refuses like the reads already did, and `cut:run` hands over what was read only when the request names the
  Recording it was read from: matched by position alone, it fitted any file.
- **The new Recording's read-ahead was lost**: the old read's refusal cleared the list the new Recording had just
  set. That read now starts as soon as the old one returns.
- **A role given during the scan was wiped**, because the scan's answer ran `chooseRecording` a second time.
  `scanFinished` in `cutSession.ts` only hides the EmptyTracks it found and takes them out of the export.
- **Switching was reported in red** ("Es wurde eine andere Aufnahme gewählt.") and blocked the new read's progress line.
- **Refusals named the wrong kind of file**, since either dialog now opens both kinds. All three ways go through one
  `openAndShow` and say "Die Datei ließ sich nicht öffnen".
- **A missed `dragleave` would have left the overlay up.** A drag over the window delivers no pointer events, so the
  next pointer move takes the overlay away.
- The voice Recording several tests generate is written once, by `src/testing/voiceRecording.ts`.

Checked over CDP on the built app (`electron.exe . --remote-debugging-port=9223`, because a dev server held port
5173): the 25-minute capture dropped while the long Recording's SourceTracks were being read gave no red message, kept the 25-minute capture on screen and drew a role
given to the 25-minute capture at once, without reading; the 25-minute capture dropped while a project read its audio gave no red message; a pointer move
after a cancelled drag hid the overlay. the long Recording's scan finished before a role could be set during it, so that case rests
on the test in `cutSession.test.ts`. The owner confirmed with a real mouse the same day that the overlay stays up
while a file is moved about over the window (so a real drag sends no pointer moves), and that dropping the 25-minute capture while
the long Recording was being read gave no red message, kept the 25-minute capture on screen and drew a role given to the 25-minute capture at once.

## Tested, and not

- `src/app/openFile.test.ts`, with the real ffprobe on a generated Recording: a video opens as a Recording, a project
  saved as `voice.SmartTrim` opens as the cut it was saved from, a folder is refused as a folder.
- The window was checked in the running Electron over the Chrome DevTools protocol (launch configuration
  `electron-debug`, `electron-vite dev --remoteDebuggingPort 9222`). `Input.dispatchDragEvent` carries real disk
  paths, so `webUtils`, the IPC and the probe all ran for real: the overlay showed while dragging, two files and a
  folder were answered with a sentence, a project was opened as a project (and refused, since the Recording it names
  is not on this machine), a Recording opened and its SourceTracks started reading, a dragged text showed no overlay,
  and `location.href` set to another site left SmartTrim where it was.
- CDP's `dragCancel` sends no `dragleave` at all, and Chromium goes on as if the drag still ran, so in that check the
  overlay stayed up. A real drag is different: the owner checked with a mouse on 2026-09-13 that the overlay appears,
  goes when the drag leaves the window and when it is cancelled with Esc, that a dropped Recording and a dropped
  project open as through the buttons, and that two files are answered with the sentence.
