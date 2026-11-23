"""Downloads each target's candidates in rank order and plate-solves them, four at a time, until one is kept.

Usage: python -P -E -X utf8 solve.py <total wanted>
Objects are tried in the order of targets.json. Stops starting new ones once solved.json holds <total wanted>
photos (all versions together); solves already running finish, so the total may end a little above. Objects already
solved or failed are skipped, so a run can be stopped and started again.

A solve is kept when the solved centre is near the catalog position, the solution is not skewed, and the field is
between MIN_FIELD and max(3°, 10 × the object's size): wide fields read better in a demo than tight crops.
"""
import math
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the repository
sys.path.insert(0, str(Path(__file__).resolve().parent))  # -P keeps the script's folder off the path
from PIL import Image, ImageOps  # noqa: E402

from common import catalog, load_json, load_state, run_solver, save_json, solver_config, solver_path, user_agent, workdir  # noqa: E402

Image.MAX_IMAGE_PIXELS = 400_000_000
MAX_SIDE = 4000          # longest side of a stored picture
MAX_PER_TARGET = 4       # candidates tried per object...
MAX_PER_TINY_TARGET = 2  # ...and per object under 2′, which rarely solve wide
MIN_FIELD = 0.5          # degrees
WORKERS = 4
SOLVE_LIMIT_S = 300      # a solve with a position hint succeeds in seconds; past this it has always failed
TEXT_IN_TITLE = re.compile(r"annot|label|beschrift", re.I)
LOCK = threading.Lock()


def log(*parts) -> None:
    with LOCK:
        print(*parts, flush=True)


def fetch(url: str, dest: Path) -> None:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=user_agent()), timeout=180) as r:
                dest.write_bytes(r.read())
            return
        except Exception as e:  # noqa: BLE001
            log("   download retry", attempt, e)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(url)


def download(root: Path, c: dict, stem: str) -> Path:
    """The candidate as an upright RGB JPEG of at most MAX_SIDE px, without EXIF (no GPS, no orientation tag)."""
    out = root / "images" / f"{stem}.jpg"
    if out.exists():
        return out
    name = urllib.parse.quote(c["title"].removeprefix("File:"))
    w, h = c["width"], c["height"]
    url = f"https://commons.wikimedia.org/wiki/Special:FilePath/{name}"
    if max(w, h) > MAX_SIDE or c["mime"] != "image/jpeg":
        url += f"?width={w if max(w, h) <= MAX_SIDE else round(w * MAX_SIDE / max(w, h))}"
    raw = root / "downloads" / f"{stem}.raw"
    if not raw.exists():
        fetch(url, raw)
    with Image.open(raw) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("I;16", "I;16B", "I", "F"):
            im = im.point(lambda v: v / 256).convert("L")
        im = im.convert("RGB")
        if max(im.size) > MAX_SIDE:
            im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        tmp = out.with_suffix(".part")
        im.save(tmp, "JPEG", quality=90, optimize=True)
        tmp.replace(out)  # never leave a half-written picture behind
    return out


def read_wcs(path: Path) -> dict:
    data = path.read_bytes()
    hdr = {}
    for i in range(0, len(data), 80):
        card = data[i:i + 80].decode("ascii", "replace")
        if card[:8].strip() == "END":
            break
        if card[8:10] == "= ":
            v = card[10:].split("/")[0].strip().strip("'").strip()
            try:
                hdr[card[:8].strip()] = float(v)
            except ValueError:
                hdr[card[:8].strip()] = v
    return hdr


def ang_sep(ra1, de1, ra2, de2) -> float:
    r = math.radians
    c = math.sin(r(de1)) * math.sin(r(de2)) + math.cos(r(de1)) * math.cos(r(de2)) * math.cos(r(ra1 - ra2))
    return math.degrees(math.acos(max(-1, min(1, c))))


def skew_deg(h: dict) -> float:
    """How far the CD matrix is from conformal: a genuine TAN solve measures under 1° (see server/astap.ts)."""
    a, b = (h["CD1_1"], h["CD2_1"]), (h["CD1_2"], h["CD2_2"])
    cos = (a[0] * b[0] + a[1] * b[1]) / (math.hypot(*a) * math.hypot(*b))
    return abs(90 - math.degrees(math.acos(max(-1, min(1, cos)))))


def solve(root: Path, cfg: Path, img: Path, stem: str, ra: float, dec: float, size_deg: float) -> dict | None:
    out = root / "solve" / stem
    out.mkdir(parents=True, exist_ok=True)
    with Image.open(img) as im:
        w, h = im.size
    args = ["--config", solver_path(cfg), "--ra", f"{ra}", "--dec", f"{dec}", "--radius", "8",
            "--downsample", "4" if max(w, h) > 3000 else "2", "--no-plots", "--crpix-center", "--cpulimit", "180",
            "--overwrite", "--new-fits", "none", "--dir", solver_path(out), "--out", "img", solver_path(img)]
    t = time.time()
    code, output = run_solver(args, SOLVE_LIMIT_S)
    wcs_file = out / "img.wcs"
    if not wcs_file.exists():
        log(f"  {stem}: {'timed out' if code == 124 else 'no solve'} ({time.time() - t:.0f}s)")
        (out / "output.txt").write_text(output, encoding="utf-8")
        return None
    hd = read_wcs(wcs_file)
    sep = ang_sep(hd["CRVAL1"], hd["CRVAL2"], ra, dec)
    field = math.hypot(hd["CD1_1"], hd["CD2_1"]) * max(w, h)
    sk = skew_deg(hd)
    max_field = max(3.0, 10 * size_deg)
    ok = sep <= max(0.5, 0.3 * field) and sk < 5 and MIN_FIELD <= field <= max_field
    log(f"  {stem}: solved {time.time() - t:.0f}s sep={sep:.2f} field={field:.2f} skew={sk:.2f} "
        f"max={max_field:.1f} ok={ok}")
    if not ok:
        return None
    # solve-field on a JPEG counts rows from the top (docs/dev/solve-field-placement.md): the build passes false.
    return {"wcs": wcs_file.relative_to(root).as_posix(), "width": w, "height": h, "fieldDeg": round(field, 3),
            "centerRa": hd["CRVAL1"], "centerDec": hd["CRVAL2"], "sepDeg": round(sep, 3)}


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    wanted = int(sys.argv[1])
    root = workdir()
    for d in ("downloads", "images", "solve"):
        (root / d).mkdir(exist_ok=True)
    cfg = solver_config(root)
    cat = catalog()
    cands = load_json(root / "candidates.json", {})
    state = load_state(root)
    used = {v["title"] for v in state["solved"].values()} | set(state["rejected"])

    def save() -> None:
        save_json(root / "solved.json", state)

    def work(dso_id: str, entry: dict) -> None:
        with LOCK:
            if len(state["solved"]) >= wanted:
                return
        obj = cat.get(dso_id)
        if not obj:
            with LOCK:
                state["failed"][dso_id] = "not in the app's catalog"
                save()
            return
        log(dso_id, entry["article"])
        tries = MAX_PER_TARGET if (obj["majAxis"] or 0) >= 2 else MAX_PER_TINY_TARGET
        tried = 0
        for n, c in enumerate(entry["candidates"][:tries]):
            with LOCK:
                if c["title"] in used or TEXT_IN_TITLE.search(c["title"]):
                    continue
            stem = f"{dso_id}_{n}"
            log(f"  {stem}: {c['title'][:80]} {c['width']}x{c['height']} {c['license']}")
            try:
                img = download(root, c, stem)
                res = solve(root, cfg, img, stem, obj["ra"], obj["dec"], (obj["majAxis"] or 10) / 60)
            except Exception as e:  # noqa: BLE001
                log(f"  {stem}: error {e}")
                res = None
            tried += 1
            if res:
                with LOCK:
                    if c["title"] in used:  # another worker took this file meanwhile
                        continue
                    state["solved"][dso_id] = {**res, "title": c["title"], "image": f"images/{stem}.jpg", "candidate": c}
                    used.add(c["title"])
                    save()
                    count = len(state["solved"])
                log(f"{dso_id}: KEPT ({count} solved)")
                return
        with LOCK:
            state["failed"][dso_id] = "no candidate solved" if tried else "no candidate"
            save()

    # Objects are tried in the order of targets.json (the user's request, first wanted first); any object with
    # candidates but no longer in targets.json comes after.
    listed = [t[0] for t in load_json(root / "targets.json", [])]
    order = [k for k in listed if k in cands] + [k for k in cands if k not in listed]
    todo = [(k, cands[k]) for k in order if k not in state["solved"] and k not in state["failed"]]
    with ThreadPoolExecutor(WORKERS) as pool:
        for f in [pool.submit(work, k, v) for k, v in todo]:
            f.result()
    print("solved", len(state["solved"]), "failed", len(state["failed"]))


if __name__ == "__main__":
    main()
