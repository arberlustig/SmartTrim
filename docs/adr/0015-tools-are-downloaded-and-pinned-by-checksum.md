# ffmpeg and the Silero model are downloaded on first run, pinned by checksum

SmartTrim ships neither ffmpeg nor the Silero VAD model. On a first run `src/tools/ensureTools.ts` fetches both into
the user's own folder — `%APPDATA%/SmartTrim/tools` for the installed app, the git-ignored `vendor/` in a checkout,
where the `bench/` scripts already look. Measured on the owner's machine: 174 MB in **20 s**, and a later start finds
the files and downloads nothing.

## What is pinned, and why exactly these

- **ffmpeg**: BtbN's `autobuild-2026-09-10-15-31`, asset `ffmpeg-N-126492-gefb0a7e5e7-win64-lgpl.zip`, SHA-256
  `6681b2b1…7024b`. Not "latest": a moving URL would quietly change the binary under every measurement in these
  ADRs. The two binaries this zip contains hash to exactly the ones that were in `vendor/` while ADR-0004, ADR-0009,
  ADR-0011 and ADR-0013 were measured — the download is the build those numbers describe.
- **Silero VAD v6.2.1**, SHA-256 `1a153a22…88e3`, the model ADR-0010's post-processing follows.

A new build or model means a new checksum **and** re-running `bench/` before the old numbers may be trusted.

## The checksum decides, not the download

Every download is hashed as the bytes arrive and compared before anything is unpacked or kept. A mismatch deletes
what was written and says so, naming the file and both hashes. This is the one place where SmartTrim would otherwise
run a binary nobody has looked at, on every Recording the owner owns, so "roughly the right size" is not enough. The
server's own `content-length` only feeds the progress line; it cannot make a wrong file pass.

Unpacking uses `tar.exe` from `%SystemRoot%/System32` — it ships with Windows 10 and later and reads zip archives, so
this needs no library. It is called by its full path: a process whose PATH does not carry System32 would otherwise
fail with "tar not found". The LGPL licence travels out of the zip along with the binaries.

## Consequences

The window calls `tools:ensure` as it opens and disables everything until it answers, with a line saying "Lädt
ffmpeg … 49 % (nur beim ersten Start)". Progress is thinned to whole percent: 174 MB arrive in thousands of chunks
and the window only draws one line.

The installer built by `npm run pack` (electron-builder, NSIS) is **126 MB**, 432 MB installed — without ffmpeg,
which the app fetches itself. `onnxruntime-node` ships a copy of the ONNX runtime for every operating system it
supports; the four SmartTrim cannot use are excluded in `electron-builder.yml`, which saved 220 MB.

Verified on 2026-09-12 by running the packaged app with an empty `%APPDATA%/SmartTrim`: the window opened (so the
native ONNX runtime loaded from the pruned package), the download ran with its percentage, the tools landed with the
pinned hashes, and a cut through the window returned the same numbers as the tests.
