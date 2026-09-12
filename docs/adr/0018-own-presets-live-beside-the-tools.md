# Own Presets live in the user's folder, and a damaged file is never silently emptied

The user can save the five settings on the sliders as a named Preset. `src/app/presets.ts` holds the rules —
adding, replacing, deleting, and the text of the file — and `src/app/presetStore.ts` puts that text on disk.
`presetNameOf(session, own)` searches the user's own Presets after the built-in ones, so a saved name appears in
the dropdown where "eigene" used to.

## What a Preset is, and is not

A Preset is the five thresholds and nothing else: threshold, Margin, EventLead, EventTail, MinimumDeadZone. It
carries **no TrackRoles** — ADR-0017's reasoning is unchanged, and the owner confirmed it again on 2026-09-12 when
this was built ("man soll einfach sagen welche Einstellungen man bei den Reglern sich setzen möchte").

All five are saved even while the window hides the two ContentEvent sliders, which it does whenever no SourceTrack
has the Content role. A Preset therefore means the same thing however the window happened to look when it was made.

## Where the file lives

`%APPDATA%/SmartTrim/presets.json` — `app.getPath("userData")`, the same folder the downloaded tools go into when
the app is packaged (ADR-0015).

Unlike the tools, this path does **not** change in a checkout. The tools live in `vendor/` there because they are
172 MB of git-ignored binaries that the bench scripts need to find. Presets are the opposite: a handful of numbers
the user built up by ear, which they expect to find again. A developer build and an installed SmartTrim share them.

## The built-in three cannot be overwritten or deleted

Gaming, Reaction and Podcast are the ground to come back to after a session of sliding. Saving under one of their
names is refused, as is deleting one — the window does not even offer a delete unless the sliders match one of the
user's own. Saving under a name the user has already used replaces it **where it stands**, so the dropdown does not
reshuffle under the cursor.

## Two kinds of damage, two answers

This is the load-bearing part, and the two cases pull in opposite directions:

- **Text that is not a preset file** — torn off mid-write, or something else entirely — reads as *no own Presets*.
  There is nothing in it to rescue, and the user carries on with the built-in three rather than facing a window
  that refuses to start.
- **A file that is one, but whose contents are wrong or newer than this SmartTrim** is *refused*. Here there is
  something to lose: emptying the list and then saving would destroy Presets that a newer version wrote, or that a
  hand edit left slightly malformed.

The same split governs reading the file at all: only `ENOENT` — there is no such file — means "none saved yet".
Any other reason it cannot be read (a folder in its place, a locked file, a drive that went away) reaches the user.
Swallowing those would make the Presets look deleted, and the next save would make that true.

## Saving writes beside the file and renames

`storeOwnPresets` writes `presets.json.writing` and renames it into place, because a rename either happens or does
not. A crash halfway through can leave a stray `.writing` file, never a half-overwritten `presets.json`.

**This guarantee is not tested.** Staging a crash mid-write needs process-level control the test suite does not
have; the two tests around it check only what the rename leaves visible — that no temp file survives a successful
save, and that a leftover one from an earlier crash is ignored. Both were confirmed to fail against a deliberately
broken implementation, so they have teeth for what they do cover.

## The choice is remembered, not deduced

`CutSession.selectedPreset` holds the name of the Preset the user last picked, and `presetChoice(session, own)`
reports it together with whether the sliders have since moved off it.

The first version worked the choice out by comparing the sliders against every Preset. The owner found the result
broken on 2026-09-12, and was right: nudging one slider made the dropdown jump to "eigene", which took away the
delete button for the Preset they were plainly still working on. Now the dropdown says **"Abend (geändert)"**,
keeps its place, and both deleting and overwriting stay reachable.

`applyPreset` is what sets the choice, so saving a new Preset marks it chosen by applying it — the sliders already
carry those values, so nothing else moves.

## No Windows popups in the window

The owner also reported that after saving, the dropdown could not be clicked until they switched to another
application and back. Two causes, both removed:

- The focused name field was hidden without the focus going anywhere. Every row that closes now hands the keyboard
  back to the dropdown.
- The overwrite and delete questions were Electron's `confirm()`, which is a real Windows popup; closing one leaves
  the window unfocused. Questions are now a row inside the window. **No renderer code calls `confirm` or `alert`
  any more**, and nothing should: the same bug comes back with the next one.

## Hiding a row needs its own CSS rule

`.preset { display: grid }` beats the browser's own `[hidden] { display: none }`, because an author rule outranks
the user-agent one. Setting `.hidden = true` on those rows therefore changed the property and nothing else: the
name field and the question row stood on screen permanently, 126 and 85 pixels of them. The owner found it — the
question "„Abend" löschen?" stayed put after they had answered it.

`.preset[hidden] { display: none }` fixes it. Any element given a `display` of its own needs the same rule.

The harness check missed this because it read `element.hidden`, the property it had just set — a test that agrees
with the code by construction. Checking the window now means reading `getComputedStyle(...).display` and the
painted height instead.

## The three buttons

**+** makes a new Preset from the sliders and asks for a name. **sichern** appears only while a Preset of the
user's own is chosen *and* changed, and writes the sliders back into it without a question — the button exists only
when there is something to write, which is statement enough. **löschen** follows the choice rather than the
sliders. Built-in Presets never offer either.

"Speichern unter …" was tried first and the owner rejected the wording.

## Tested at three seams

Confirmed with the owner before any test was written: the rules without a disk (`presets.test.ts`), the real file
in a real folder (`presetStore.test.ts`), and what the window says the settings are (`cutSession.test.ts`). The
dropdown, the name field and the IPC glue are untested by design, as all of the window is (ADR-0012); they were
checked by hand in the browser-pane harness on 2026-09-12.

Nothing here touches the exported XML, so no Premiere import check was needed for this change.
