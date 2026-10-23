# SmartTrim
Cut silence from long recordings and get a ready-to-edit Premiere Pro project. Free, local, open source.

## Running it from a checkout

```
npm install
npm run dev
```

On a first run SmartTrim downloads ffmpeg and the Silero VAD model into `vendor/` and checks every file against its
pinned checksum (ADR-0015, ADR-0031); `npm test` runs the test suite.

## Building the installer

```
npm run pack
```

Writes `release/SmartTrim-Setup-<version>.exe` (Windows x64), its `.blockmap` and `latest.yml`. The installer does
not contain ffmpeg — the app fetches it on its first start, into the user's own folder.

## Releasing

An installed SmartTrim updates itself from this repository's latest GitHub release. Every release carries three files
from `release/`: the installer and `latest.yml`, without which installed copies cannot update, and the `.blockmap`,
which lets the next update download only what changed. The steps are in ADR-0032.
