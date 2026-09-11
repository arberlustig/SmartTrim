import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

SR = 16000
CHUNK = 512
CONTEXT = 64
MODEL = Path(__file__).resolve().parents[1] / "vendor" / "silero_vad.onnx"


def load(path):
    raw = np.fromfile(path, dtype=np.int16)
    n = (len(raw) // CHUNK) * CHUNK
    return raw[:n].astype(np.float32) / 32768.0


def run(audio, with_context, limit=None):
    sess = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    state = np.zeros((2, 1, 128), dtype=np.float32)
    sr = np.array(SR, dtype=np.int64)
    ctx = np.zeros((1, CONTEXT), dtype=np.float32)
    n = len(audio) // CHUNK
    if limit:
        n = min(n, limit)
    out = np.empty(n, dtype=np.float32)
    for i in range(n):
        chunk = audio[i * CHUNK:(i + 1) * CHUNK].reshape(1, -1)
        inp = np.concatenate([ctx, chunk], axis=1) if with_context else chunk
        p, state = sess.run(None, {"input": inp, "state": state, "sr": sr})
        out[i] = p[0, 0]
        ctx = chunk[:, -CONTEXT:]
    return out


def levels(audio):
    f = audio.reshape(-1, CHUNK)
    rms = np.sqrt(np.mean(f ** 2, axis=1))
    peak = np.max(np.abs(f), axis=1)
    d = lambda v: 20 * np.log10(np.maximum(v, 1e-10))
    return d(rms), d(peak)


for path in sys.argv[1:]:
    audio = load(path)
    rms, peak = levels(audio)
    print(f"\n=== {Path(path).name} ===")
    print(f"  RMS   mittel {rms.mean():6.1f}  p95 {np.percentile(rms,95):6.1f}  max {rms.max():6.1f} dBFS")
    print(f"  PEAK  mittel {peak.mean():6.1f}  p95 {np.percentile(peak,95):6.1f}  max {peak.max():6.1f} dBFS")
    print(f"  Anteil Chunks ueber -40 dBFS (peak): {100*(peak>-40).mean():.1f} %")
    for ctx in (False, True):
        p = run(audio, ctx, limit=8000)
        label = "mit Kontext (576)" if ctx else "ohne Kontext (512)"
        print(f"  {label}: prob mittel {p.mean():.4f}  max {p.max():.4f}  "
              f"Anteil>0.5 {100*(p>0.5).mean():.1f} %  Anteil>0.1 {100*(p>0.1).mean():.1f} %")
