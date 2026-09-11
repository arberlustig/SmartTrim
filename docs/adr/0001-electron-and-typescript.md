# Electron and TypeScript, not Tauri and Rust

SmartTrim uses Electron with TypeScript throughout, even though Tauri would produce a ~10 MB installer instead of ~200 MB and offers more headroom for numeric work. Measurements on the target machine showed the analysis is bound by disk reads, ffmpeg processes and the ONNX runtime — all of which are native either way — so the host language contributes nothing measurable to the runtime.

The deciding factor was maintenance: the owner does not read this codebase and future work happens through AI sessions, where mainstream TypeScript is a far safer bet than Rust audio code.

## Consequences

The predecessor project was also Electron and was slow. That was caused by reading the Recording once per SourceTrack and writing gigabytes of intermediate WAV files, not by the framework — see ADR-0004 and ADR-0005.
