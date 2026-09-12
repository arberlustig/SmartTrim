# SmartTrim
Cut silence from long recordings and get a ready-to-edit Premiere Pro project. Free, local, open source.

## Running it from a checkout

```
npm install
npm run dev
```

On a first run SmartTrim downloads ffmpeg and the Silero VAD model into `vendor/` and checks them against pinned
checksums (ADR-0015); `npm test` runs the test suite.

## Building the installer

```
npm run pack
```

Writes `release/SmartTrim Setup <version>.exe` (Windows x64). The installer does not contain ffmpeg — the app
fetches it on its first start, into the user's own folder.
