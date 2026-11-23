"""Reviewing the solved photos.

Usage: python -P -E -X utf8 review.py <command>
  status                 counts, the failed objects, the photos still without an entry in entries.json
  sheet                  contact sheets (20 per sheet) of the photos without an entry, in review/
  sheet ID[,ID...]       contact sheet of the given photos
  reject ID "reason"     the image is out (text, inset, empty frame...): solve.py tries the object's next candidate
  drop ID "reason"       the object is out for good (no other image wanted, or it is inside another photo)

Run reject/drop only while solve.py is not running: both write solved.json.
"""
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the repository
sys.path.insert(0, str(Path(__file__).resolve().parent))  # -P keeps the script's folder off the path
from PIL import Image, ImageDraw  # noqa: E402

from common import load_json, load_state, save_json, workdir  # noqa: E402

THUMB = 360


def without_entry(root: Path, state: dict) -> list[str]:
    entries = load_json(root / "entries.json", {})
    return [k for k in state["solved"] if k not in entries]


def sheet(root: Path, state: dict, keys: list[str]) -> None:
    (root / "review").mkdir(exist_ok=True)
    for start in range(0, len(keys), 20):
        part = keys[start:start + 20]
        img = Image.new("RGB", (5 * THUMB, 4 * (THUMB + 24)), "white")
        draw = ImageDraw.Draw(img)
        for i, k in enumerate(part):
            v = state["solved"][k]
            with Image.open(root / v["image"]) as im:
                im.thumbnail((THUMB, THUMB))
                x, y = (i % 5) * THUMB, (i // 5) * (THUMB + 24)
                img.paste(im, (x + (THUMB - im.width) // 2, y + 24 + (THUMB - im.height) // 2))
            draw.text((x + 4, y + 4), f"{k}  {v['fieldDeg']:.2f} deg", fill="black")
        out = root / "review" / f"sheet-{start // 20 + 1}.jpg"
        img.save(out, quality=85)
        print(out)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = workdir()
    state = load_state(root)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "status":
        pending = without_entry(root, state)
        print(len(state["solved"]), "solved,", len(pending), "without an entry:", ",".join(pending))
        for k, why in state["failed"].items():
            print(f"  failed {k}: {why}")
    elif cmd == "sheet":
        keys = args[0].split(",") if args else without_entry(root, state)
        sheet(root, state, [k for k in keys if k in state["solved"]])
    elif cmd in ("reject", "drop") and len(args) == 2:
        dso_id, reason = args
        photo = state["solved"].pop(dso_id, None)
        if photo:
            state["rejected"].append(photo["title"])
        if cmd == "drop":
            state["failed"][dso_id] = f"dropped: {reason}"
        else:
            state["failed"].pop(dso_id, None)
        state.setdefault("reasons", {})[dso_id] = reason
        save_json(root / "solved.json", state)
        print(cmd, dso_id, "-", reason)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
