# SmartTrim updates itself from its GitHub releases

On 2026-10-23 a colleague of the owner found that SmartTrim has no automatic update. The owner remembered deciding
against one, and wanted it now. The same colleague's fresh 1.1.0 could not download ffmpeg (ADR-0031): with an update
in place the fix would have reached them without anyone sending a new installer.

## Decided

- **electron-updater 6.8.10** (exact version), reading the releases of the public repository `arberlustig/SmartTrim`
  (`publish` in `electron-builder.yml`). It reads `github.com/…/releases.atom`, `…/releases/latest` and that release's
  `latest.yml` — web pages, not the API, so no rate limit applies. Drafts and pre-releases are never offered.
- **Asked at start and every six hours** while SmartTrim is open. A newer version downloads at once in the background
  and **installs without a question when SmartTrim closes**. "Jetzt neu starten" installs it at once and starts the new
  version. Both run the installer silently: the assisted installer (`oneClick: false`) would otherwise show its pages
  again, and its finish page would not start SmartTrim. The folder chosen at the first installation is kept — the
  installer reads it from the registry and skips the folder page on an update.
- **The window says only what concerns the user**, on one line under the header: "SmartTrim 1.3.0 wird geladen …
  41 %", "SmartTrim 1.3.0 ist bereit und wird beim Schließen installiert. [Jetzt neu starten]", or "SmartTrim 1.3.0
  ließ sich nicht laden – SmartTrim versucht es später wieder." Nothing while checking, when SmartTrim is current, or
  when the check itself failed — offline, GitHub away — because nobody can do anything about that while cutting. Why
  anything failed is written to `%APPDATA%\SmartTrim\update.log`, written afresh on every start so it never grows. A
  download that broke off is tried again with the next check.
- **"Jetzt neu starten" waits** while a Recording is read, cut or saved, and while the tools are fetched. The question
  stands on the very button that was pressed, so the second click of a double click is ignored and the keyboard's
  focus moves to Abbrechen, as in the dialog before closing a Tab. A restart
  closes every Tab and Tabs are not restored (ADR-0025), so held stretches no saved project holds are asked about first,
  in the line itself: "In einem Tab sind festgehaltene Stellen nicht gespeichert – beim Neustart sind sie weg.
  [Trotzdem neu starten] [Abbrechen]". Closing the window has never asked, and installing on closing changes nothing
  about that.
- What an update is doing is a small state machine in `src/app/selfUpdate.ts` — found, loading, ready, failed, and
  which events may change which — tested on its own. `src/main/keepUpToDate.ts` only connects electron-updater to it;
  the window takes its sentences from `texts.ts` (ADR-0030). electron-updater's own `checkForUpdatesAndNotify` is not
  used: its notification is English only.
- electron-updater is CommonJS and defines `autoUpdater` as a getter, which Node's ES module import cannot see as a
  named export: it is imported by default and `autoUpdater` read inside `keepUpToDate`, after Electron is ready —
  reading it builds the updater, which needs Electron's `app`.
- A SmartTrim run from a checkout never updates itself.

## How a release is made

Without the installer and `latest.yml` on the latest release, every installed SmartTrim reports an error at each check
and stays where it is. The `.blockmap` goes along too: without it an update still works, but downloads the whole
installer instead of what changed.

1. `npm version x.y.z --no-git-tag-version`, commit "Call SmartTrim version x.y.z", `npm run pack` (it uploads nothing:
   `--publish never`).
2. Push `main`. `gh release create` makes the tag from GitHub's `main` when the tag does not exist yet; unpushed, the
   tag would point at a commit without the release in it.
3. `gh release create vx.y.z --draft --title … --notes …` with `release/SmartTrim-Setup-x.y.z.exe`, its `.blockmap`
   and `latest.yml`; then publish the draft as the latest release, not as a pre-release. A draft first, so no
   installed copy ever sees a `latest.yml` whose installer is not uploaded yet.
4. `curl -sL https://github.com/arberlustig/SmartTrim/releases/latest/download/latest.yml` must name the new version.

- Never mark a release that is not SmartTrim itself as the latest: the updater reads `latest.yml` from whatever
  release is.
- Keep old releases and their `.blockmap`: downloading only what changed needs the previous version's.
- The installer's name has dashes (`nsis.artifactName`), because `latest.yml` names it with dashes and GitHub turns a
  space in an uploaded name into a dot: v1.1.0's installer is called `SmartTrim.Setup.1.1.0.exe` on GitHub.
- Publishing is outward-facing: only after the owner said yes.

## What protects whom

SmartTrim is not signed, so electron-updater checks no signature (it does so only when `publisherName` is set). It
does check the SHA-512 from `latest.yml`, which catches a broken download, not someone who can publish releases in the
repository — the same trust the first installer download already asked for. Signing later would mean every update
from then on must carry the same certificate.

At start and every six hours SmartTrim asks github.com whether there is a newer version; GitHub sees the address it
asks from. electron-updater would also send a random ID it makes once per installation (`x-user-staging-id`, kept in
`.updaterId` beside the user's data), meant for staged rollouts, which SmartTrim does not use. `keepUpToDate` replaces
it with one value shared by every installation, so the checks of one installation cannot be linked across addresses.
Nothing else leaves the machine.

An installed SmartTrim runs only once: a second start brings the open window to the front. The silent installer of an
update ends every SmartTrim running from the installation folder without a question, so a second window would have
lost its held stretches unasked. A SmartTrim run from a checkout takes no such lock, so it can still run beside the
installed one for tests.

## Consequences

1.1.0 has no updater: whoever has it installs 1.2.0 by hand once. Downloading only what changed starts with the step
from 1.2.0 to the next version, since 1.1.0 left no `.blockmap` on GitHub.

## Tested, and not

`src/app/selfUpdate.test.ts`: a found version loads and becomes ready; no newer version leaves SmartTrim current; a
check that fails before anything was found shows nothing; a found version that does not arrive is said to have failed;
a ready update stays ready whatever comes after; when another check may run; and what the window says in each state, in
both languages. The line itself and its button are window glue (ADR-0012), checked over the Chrome DevTools protocol.
A real update from GitHub can only be checked once a release with `latest.yml` exists — the owner's check.
