import re
import sys
from pathlib import Path

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
text = src.read_text(encoding="utf-8")

text = re.sub(r"(file://localhost/)[^<]*/([^/<]+)</pathurl>", r"\1C%3a/media/\2</pathurl>", text)
text = text.replace("user", "user")

dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(text, encoding="utf-8")

leaked = [m for m in re.findall(r"<pathurl>[^<]*</pathurl>", text) if "user" in m]
print(f"{dst.name}: {len(text)} Zeichen geschrieben, Restfunde: {len(leaked)}")
for line in re.findall(r"<pathurl>[^<]*</pathurl>", text)[:2]:
    print(f"  {line}")
