# ffmpeg comes from a month-end build, pinned file by file

On 2026-10-23 a colleague of the owner installed SmartTrim 1.1.0 and got, on its first start, "Die Werkzeuge fehlen:
ffmpeg could not be downloaded from https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-10-15-31/
ffmpeg-N-126492-gefb0a7e5e7-win64-lgpl.zip: HTTP 404." Every fresh installation had been failing like that for about a
month; every installation made before kept working, because it never downloads again.

## Why the pinned build vanished

BtbN keeps the last 14 daily releases and the last release of each month for 24 months, and deletes the tag and the
assets of everything else (README, "Release Retention Policy"; `util/prunetags.sh`: `KEEP_LATEST=14`,
`KEEP_MONTHLY=24`). The 14 count releases, not days, so a few manual runs shorten it. The build ADR-0015 pinned came
from a manual run on 2026-09-10 and was no month-end build: it lived about two weeks. It is not on the Wayback Machine
or anywhere else on the web. The only copies left are the git-ignored `vendor/builds/N-126492-gefb0a7e5e7/` and the
tools folders of installations made in September.

## Decided

- **ffmpeg is BtbN's month-end build of September**: `autobuild-2026-09-30-13-08`,
  `ffmpeg-N-127032-g6ae491a26c-win64-lgpl.zip`, SHA-256 `c73ad424…0658e3`, 176,142,306 bytes. BtbN keeps it until about
  **2028-09**. Before then a SmartTrim release must move the pin to a newer month-end build; the self-update
  (ADR-0032) carries that to every installation. Only month-end builds may be pinned.
- **It answers everything SmartTrim asks of ffmpeg exactly as the measured build did.** `bench/compare_ffmpeg_builds.ts`
  runs SmartTrim's own probe, scan, decode, Excerpt and picture with two builds and compares the answers byte for byte.
  On six real OBS Recordings — one single-track video, five with six stereo SourceTracks, the longest 8.6 GB — the
  probe, the scan's levels, the 16 kHz PCM of every SourceTrack and every Excerpt were identical; one Recording was
  refused by both builds with the same words (its frame rate). The picture's JPEGs differed only by the libavcodec
  version ffmpeg writes into each image: with `-fflags +bitexact -flags:v +bitexact` they were identical too. So the
  measurements of ADR-0004, ADR-0009, ADR-0011 and ADR-0013 hold for the new build without being made again. The times
  the script prints were not comparable on that run: the old build read the slow G: drive first and the new one found
  the files in the cache.
- **Every kept file is pinned by its own SHA-256** (`unpack` in `PINNED_TOOLS`), the zip's checksum is still checked
  first. A zip that arrives intact but holds other files than pinned is refused, naming the file and both checksums,
  and the files already installed stay as they were. Packing the same files into another zip, or fetching them from
  another address, downloads nothing on an installation that already holds them.
- **What was checked is recorded** in `verified.json` beside the tools: each kept file's own SHA-256, size and
  modification time, computed by SmartTrim itself. A start that finds size and time unchanged trusts the record
  instead of hashing again. Before, `ensureTools` only asked whether the files existed — an updated SmartTrim that
  pinned another build would have kept the old one for ever while fresh installations got the new one.

## What happens on a start

- Size and time as recorded, checksum the pinned one: nothing is read. Four `stat` calls and a small JSON file, about
  1 ms.
- No record (every installation made by 1.1.0), an unreadable one, or a file whose size or time changed: that file is
  hashed. Measured on the owner's i5-10400, which has no SHA instructions: about 0.7 s for both binaries, CPU-bound;
  Windows Defender adds up to several seconds on a freshly written 130 MB `.exe`. The window says "Prüft ffmpeg …
  40 %".
- A recorded file whose checksum is not the pinned one (an update moved the pin): downloaded without hashing first. The
  window says "Lädt ffmpeg neu … 40 %" — not "nur beim ersten Start", which was only ever true on a first start.
- One missing file of a zip brings the whole zip again.

Hashing would have been simpler done on every start, but 0.7 s of a disabled window on every start, more on a hard
disk, buys only the detection of a file changed without changing its size or time.

## Not chosen

- **Hosting the old binaries in a SmartTrim release.** It would have kept the measured build itself, but whoever hands
  out binaries owes their corresponding source. BtbN's "LGPL" build links FFTW, which is GPL, through chromaprint, so
  the executables are GPLv3 as a whole; their source is FFmpeg at `efb0a7e5e7`, BtbN's scripts at `cc8f0958` and about
  twenty statically linked libraries at their pinned commits — 1–2 GB, built with Docker, to be hosted beside the
  binaries for as long as they are offered. Downloading from BtbN leaves that duty with BtbN.
- **BtbN's `latest` address.** Its content changes every day, so a checksum would fail the next morning.
- **Gyan's builds**, kept for years: GPL builds and a different binary, with nothing to gain over a month-end BtbN
  build.

## Consequences

Every installation made by 1.1.0 downloads ffmpeg once more after updating — 176 MB, the new build. The licence file
in the zip is unchanged (`COPYING.LGPLv3`). `bench/compare_ffmpeg_builds.ts` is the tool for the next move; keep the
build being replaced in `vendor/builds/` until the comparison is done.

## Tested, and not

`src/tools/ensureTools.test.ts` against a fake download host serving real zips: a first run downloads, unpacks and
records; an unchanged installation neither downloads nor hashes; a tampered download is refused and leaves nothing; an
installation without a record, or with an unreadable one, is hashed once and downloads nothing, also from a new
address; a moved pin replaces only its own source without hashing; a file changed by hand, or missing, is replaced; a
file whose time changed but not its bytes is hashed and kept; a zip holding other files than pinned is refused and the
installation stays; and the pins themselves are written out, so moving them is a visible change. Not tested by a test:
the real download from BtbN in the installed app — that is the owner's check, with an empty `%APPDATA%\SmartTrim`.
