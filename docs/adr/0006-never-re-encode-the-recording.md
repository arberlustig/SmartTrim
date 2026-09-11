# SmartTrim never re-encodes the Recording

SmartTrim reads a Recording and writes a CutPlan, an FCP7 XML and a TrimProject. It never writes video, and it never writes audio files that the exported project depends on. The XML references the original Recording, so the edit carries the original quality exactly — nothing is transcoded and there is no generation loss.

## Consequences

This is a deliberate scope boundary, not a missing feature. Rendering is the slowest and most failure-prone part of such a tool, and the user edits in Premiere anyway, so a second render path would serve nobody.

The predecessor advertised an MP4 export that was a stub returning `"(MP4 render TODO)"` while the interface reported "Export complete!". It also pointed the exported XML at extracted WAV files rather than the Recording, so deleting those temporary files broke the project. Neither is permitted here.
