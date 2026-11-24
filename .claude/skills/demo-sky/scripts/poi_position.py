"""Sky position of a point in a kept picture (a comet's head, an asteroid, a supernova), for a point of interest.

Usage: python -P -E -X utf8 poi_position.py ID:x:y [ID:x:y ...]
x, y: the point's rough pixel in images/<file> (from the top-left), read off the picture. The brightest spot within
30 px is taken, then turned into RA/Dec through the photo's solution (TAN + SIP).
"""
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the repository
sys.path.insert(0, str(Path(__file__).resolve().parent))  # -P keeps the script's folder off the path
from PIL import Image  # noqa: E402

from common import load_state, workdir  # noqa: E402

if len(sys.argv) < 2:
    sys.exit(__doc__)
work = workdir()
solved = load_state(work)["solved"]


def header(path: Path) -> dict:
    data, h = path.read_bytes(), {}
    for i in range(0, len(data), 80):
        card = data[i:i + 80].decode("ascii", "replace")
        if card[:8].strip() == "END":
            break
        if card[8:10] == "= ":
            v = card[10:].split("/")[0].strip().strip("'").strip()
            try:
                h[card[:8].strip()] = float(v)
            except ValueError:
                h[card[:8].strip()] = v
    return h


def sky(h: dict, x: float, y: float) -> tuple[float, float]:
    u, v = x + 1 - h["CRPIX1"], y + 1 - h["CRPIX2"]  # FITS pixels count from 1
    du = sum(h.get(f"A_{p}_{q}", 0) * u ** p * v ** q for p in range(6) for q in range(6))
    dv = sum(h.get(f"B_{p}_{q}", 0) * u ** p * v ** q for p in range(6) for q in range(6))
    u, v = u + du, v + dv
    xi = math.radians(h["CD1_1"] * u + h["CD1_2"] * v)
    eta = math.radians(h["CD2_1"] * u + h["CD2_2"] * v)
    a0, d0 = math.radians(h["CRVAL1"]), math.radians(h["CRVAL2"])
    den = math.cos(d0) - eta * math.sin(d0)
    ra = a0 + math.atan2(xi, den)
    dec = math.atan2(math.sin(d0) + eta * math.cos(d0), math.hypot(xi, den))
    return math.degrees(ra) % 360, math.degrees(dec)


for arg in sys.argv[1:]:
    k, x, y = arg.split(":")
    s = solved[k]
    with Image.open(work / s["image"]) as im:
        g = im.convert("L")
        x, y, r = int(x), int(y), 30
        best = max(((g.getpixel((i, j)), i, j) for i in range(max(0, x - r), min(g.width, x + r))
                    for j in range(max(0, y - r), min(g.height, y + r))))
    ra, dec = sky(header(work / s["wcs"]), best[1], best[2])
    print(f"{k}: pixel {best[1]},{best[2]} (brightness {best[0]}) -> ra {ra:.4f} dec {dec:.4f}")
