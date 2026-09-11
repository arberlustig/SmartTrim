"""Spike: does Silero VAD separate speech from game audio on real material?

Compares VAD against a plain dBFS threshold, the approach every competitor uses.
Not product code.
"""
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

SR = 16000
CHUNK = 512
# Silero v5 wants the previous 64 samples prepended. Omit them and the model
# silently returns ~0 for every chunk instead of failing.
CONTEXT = 64
MODEL = Path(__file__).resolve().parents[1] / "vendor" / "silero_vad.onnx"
DB_THRESHOLD = -30.0
SPEECH_PROB = 0.5


def load_pcm(path):
    raw = np.fromfile(path, dtype=np.int16)
    n = (len(raw) // CHUNK) * CHUNK
    return raw[:n].astype(np.float32) / 32768.0


def vad_probs(audio):
    sess = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    state = np.zeros((2, 1, 128), dtype=np.float32)
    sr = np.array(SR, dtype=np.int64)
    ctx = np.zeros((1, CONTEXT), dtype=np.float32)
    out = np.empty(len(audio) // CHUNK, dtype=np.float32)
    for i in range(len(out)):
        chunk = audio[i * CHUNK:(i + 1) * CHUNK].reshape(1, -1)
        p, state = sess.run(
            None,
            {"input": np.concatenate([ctx, chunk], axis=1), "state": state, "sr": sr},
        )
        out[i] = p[0, 0]
        ctx = chunk[:, -CONTEXT:]
    return out


def chunk_dbfs(audio):
    frames = audio.reshape(-1, CHUNK)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-10))


def to_segments(mask):
    """Contiguous True runs as (start_chunk, end_chunk) pairs."""
    padded = np.concatenate(([False], mask, [False]))
    edges = np.diff(padded.astype(np.int8))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    return list(zip(starts, ends))


def fmt(chunk_index, offset_s):
    t = offset_s + chunk_index * CHUNK / SR
    return f"{int(t // 60):02d}:{t % 60:05.2f}"


def report(path, offset_s):
    audio = load_pcm(path)
    dur = len(audio) / SR
    probs = vad_probs(audio)
    db = chunk_dbfs(audio)

    speech = probs > SPEECH_PROB
    loud = db > DB_THRESHOLD

    seg = to_segments(speech)
    lens = [(e - s) * CHUNK / SR for s, e in seg]

    print(f"\n=== {Path(path).name}  ({dur/60:.1f} min) ===")
    print(f"  mittlerer Pegel        : {np.mean(db):.1f} dBFS   (Minimum {np.min(db):.1f})")
    print(f"  VAD sagt Sprache       : {100*speech.mean():5.1f} %")
    print(f"  Pegel > {DB_THRESHOLD:.0f} dBFS      : {100*loud.mean():5.1f} %   <- so entscheiden die Mitbewerber")
    print(f"  --> entfernbar laut VAD: {100*(1-speech.mean()):5.1f} %")
    print(f"  --> entfernbar laut dB : {100*(1-loud.mean()):5.1f} %")
    if lens:
        print(f"  Sprechstellen          : {len(seg)}, Median {np.median(lens):.2f} s, "
              f"längste {max(lens):.1f} s")
        longest = sorted(seg, key=lambda p: p[1] - p[0], reverse=True)[:8]
        print("  längste Sprechstellen (zum Nachhören in Premiere):")
        for s, e in sorted(longest):
            print(f"    {fmt(s, offset_s)} - {fmt(e, offset_s)}   ({(e-s)*CHUNK/SR:.1f} s)")
    else:
        print("  Sprechstellen          : keine")


if __name__ == "__main__":
    offset = float(sys.argv[1])
    for p in sys.argv[2:]:
        report(p, offset)
