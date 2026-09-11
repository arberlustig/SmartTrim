# Cutting decisions come from speech detection, not level thresholds

Every comparable tool decides what to remove with a decibel threshold. For gaming recordings that is the wrong question: game audio is almost never quiet, so a level threshold either removes nothing or removes speech along with everything else. SmartTrim instead runs voice activity detection (Silero VAD, a 2.3 MB ONNX model, roughly 800× realtime on CPU) over Voice tracks and asks whether someone is *speaking*.

Content tracks are judged the same way in spirit: a ContentEvent is a departure from that track's own recent baseline, never an absolute level. Steady background music is not content.

## Consequences

An earlier draft of this model treated Content tracks as "keep while loud". Walking through a concrete case killed it: during gaming the music runs continuously, so nothing would ever be removed — the same trap already identified for reaction videos. Relative detection is what makes the Gaming preset actually cut.

Because relative detection is the riskier half, every Preset carries a switch that drops Content tracks to Ignored, leaving the Voice track alone in charge. That is the fallback if event detection disappoints on real material.
