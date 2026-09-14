import os
import re
import sys
from pathlib import Path

# Copies a Premiere export into fixtures/ with the recording's folder replaced by C:/media and the Windows user name
# scrubbed, so nothing personal lands in the public repository.   python bench/sanitize_fixture.py <export.xml> <fixture.xml>
src, dst = Path(sys.argv[1]), Path(sys.argv[2])
text = src.read_text(encoding="utf-8")
user_name = os.environ.get("USERNAME", "")

text = re.sub(r"(file://localhost/)[^<]*/([^/<]+)</pathurl>", r"\1C%3a/media/\2</pathurl>", text)
if user_name:
    text = text.replace(user_name, "user")

dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(text, encoding="utf-8")

leaked = [m for m in re.findall(r"<pathurl>[^<]*</pathurl>", text) if user_name and user_name in m]
print(f"{dst.name}: {len(text)} Zeichen geschrieben, Restfunde: {len(leaked)}")
for line in re.findall(r"<pathurl>[^<]*</pathurl>", text)[:2]:
    print(f"  {line}")
