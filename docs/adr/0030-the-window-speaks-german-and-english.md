# The window speaks German and English

Asked for by the owner on 2026-09-14, right after the new look: "Wir brauchen eigentlich auch noch Localization für
die englische Sprache." The repository is public, and the window was German through and through — every sentence
sat where it was shown, in `index.html` and `renderer.ts`.

## Decided

- **Every sentence the user reads lives in `src/app/texts.ts`**, once per language, under one `Texts` interface —
  so a sentence missing in one language is a type error, and `texts.test.ts` walks both trees to make sure neither
  says nothing anywhere. Fixed sentences are strings; sentences with a number or a name in them are functions, so each
  language can put the number where its grammar wants it ("3 Dateien ließen sich nicht öffnen" / "3 files could not
  be opened") and choose its own singular and plural.
- **The fixed sentences of the page are marked with `data-text="key"`** (`data-text-title`, `data-text-placeholder`
  for titles and placeholders; dotted keys such as `sliders.threshold.label` reach into nested texts) and filled by
  `applyTexts` at startup and on every switch. The German stays in the HTML as what the page holds before the script
  runs. Everything the window draws itself goes through `T`, the texts of the language spoken now.
- **The language follows the system, unless the user chose one**: `languageOf` takes German on a German Windows and
  English anywhere else (`navigator.language`); the choice at the top right of the header is remembered in
  `localStorage` under `smarttrim.language`. Switching redraws the window at once. A status line put up before the
  switch keeps its language until it is replaced; they are short-lived.
- **The main process holds no sentences.** The three file dialogs (choose Recordings, open projects, save the Premiere
  file) take their title and filter names from the window with the request (`DialogTexts`), so main need not know
  which language is spoken.
- **Technical refusals stay English.** What the modules throw — "ffprobe could not read …", "There is no preset named
  …" — is the grey detail line under a localized sentence ("Grund: …" / "Reason: …"), and was English already for all
  but the presets' four, which now are too. Translating the detail lines would mean threading a language through every
  module and its tests for text that names files, codecs and formats.
- **Preset names are data, not text.** Gaming, Reaction and Podcast are saved in projects and preset files by name,
  so they read the same in both languages.
- **Lengths and numbers follow the language**: "2 Std 32 Min" / "2 h 32 min", "0,05 s" / "0.05 s", through `Texts.duration`
  and `decimalsIn`.

## What changed underneath

- The window's status line now records who put it up (`kind: "plain" | "job" | "skipped"`), where before the
  renderer recognised a job's line by its German words ("Liest den Ton …"). `waitOf` takes the fallback lines for the
  bars from the texts, so `src/app/waiting.ts` holds no sentence either.
- The "eigene"/"custom" entry of the Preset dropdown is an internal value (`__own__`) shown in the language spoken;
  before, the German word itself was the value.

## Tested, and not

- `src/app/texts.test.ts`: both languages define every sentence and the same set of them; lengths and decimals per
  language; sentences with a count for one and for many; `languageOf` for a chosen language, a German system, and
  anything else.
- `src/app/waiting.test.ts` passes the lines in; the presets' refusals are asserted in English.
- The switch, the marking of the page and the dialogs are window glue (ADR-0012), checked over the Chrome DevTools
  protocol on the built app: the window starts German on this German Windows; switching to English puts every marked
  sentence into English and redraws the Tabs, the rows, the result and the hints; a cut in English reads "Of 25 min,
  20 min remain – 22 % are gone."; the choice survives a restart. Whether a native dialog carries the English title
  needs a click by hand.
