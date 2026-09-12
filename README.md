# SmartTrim
Cut silence from long recordings and get a ready-to-edit Premiere Pro project. Free, local, open source.

## Running it

```
npm install
npm run dev
```

`vendor/` has to hold `ffmpeg.exe`, `ffprobe.exe` and `silero_vad.onnx`; the first-run download that fills it is not
built yet. `npm test` runs the test suite, `npm run build` writes the app into `out/`.
