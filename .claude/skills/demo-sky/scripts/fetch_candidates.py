"""Lists free-licensed Wikimedia Commons images for each target of targets.json; writes candidates.json (top 5 each).

Usage: python -P -E -X utf8 fetch_candidates.py
Targets already in candidates.json are skipped; delete an entry to fetch it again.
"""
import math
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the repository
sys.path.insert(0, str(Path(__file__).resolve().parent))  # -P keeps the script's folder off the path
from common import COMMONS, WIKIDATA, api, load_json, save_json, strip_html, workdir

FREE = re.compile(r"^(public domain|pd|cc0|cc by(-sa)? \d(\.\d)?( [a-z]+)?|cc by(-sa)?)$", re.I)
# In the file name: anything that is not a plain photograph of the field.
EXCLUDE_TITLE = re.compile(
    r"hubble|\bhst\b|jwst|webb|chandra|spitzer|infrared|x-ray|xray|handout|label|annot|beschrift|chart|\bmap\b|"
    r"diagram|finder|drawing|sketch|spectr|animation|comparison|illustration|artist|simulat|2mass|\bwise\b|galex|"
    r"radio|alma|herschel|crop|detail|close-?up|core|centre|center|vlt|gemini|subaru|euclid|logo|stamp|poster|svg|"
    r"\bgif\b|heic|potw|zoom|planck|lofar|jet\b|nucleus|ultraviolet|\buv\b",
    re.I,
)
EXCLUDE_DESC = re.compile(
    r"hubble|\bhst\b|jwst|webb|chandra|spitzer|infrared|x-ray|annotat|labell?ed|illustration|artist's|simulation|"
    r"herschel|alma\b|radio",
    re.I,
)
CAPTURE = re.compile(
    r"exposure|integration|\bsubs?\b|\bframes?\b|\b\d+\s*(x|×)\s*\d+|\bhours?\b|\bmin(utes)?\b|telescope|refractor|"
    r"reflector|newton|\bf/\d|\bmm\b|camera|\biso\b|canon|nikon|sony|zwo|asi\d|qhy|atik|sbig|filter|h-?alpha|oiii|lrgb",
    re.I,
)


def wikidata_category(article: str) -> tuple[str | None, str | None]:
    """The Commons category (P373) and the image (P18) of an English Wikipedia article."""
    d = api(WIKIDATA, {"action": "wbgetentities", "sites": "enwiki", "titles": article, "props": "claims",
                       "redirects": "yes"})
    for ent in d.get("entities", {}).values():
        claims = ent.get("claims", {})
        cat = claims.get("P373", [{}])[0].get("mainsnak", {}).get("datavalue", {}).get("value")
        img = claims.get("P18", [{}])[0].get("mainsnak", {}).get("datavalue", {}).get("value")
        return cat, img
    return None, None


def designation_category(dso_id: str) -> str | None:
    """A Commons category named after the designation, for objects Wikidata gives none."""
    names = []
    for pattern, forms in (
        (r"^M(\d+)$", ["Messier {}"]), (r"^NGC(\d+)$", ["NGC {}"]), (r"^IC(\d+)$", ["IC {}"]),
        (r"^SH2-(\d+)$", ["Sh2-{}", "Sharpless {}", "Sh 2-{}"]), (r"^Barnard(\d+)$", ["Barnard {}"]),
        (r"^LDN(\d+)$", ["LDN {}", "Lynds {}"]), (r"^vdB(\d+)$", ["vdB {}", "Van den Bergh {}"]),
    ):
        m = re.match(pattern, dso_id, re.I)
        if m:
            names = [f.format(m[1]) for f in forms]
    for name in names:
        d = api(COMMONS, {"action": "query", "titles": "Category:" + name, "prop": "categoryinfo", "redirects": 1})
        for page in d["query"]["pages"].values():
            if "missing" not in page:
                return page["title"].removeprefix("Category:")
    return None


def category_files(cat: str, limit: int = 600) -> list[str]:
    out, cont = [], {}
    while len(out) < limit:
        d = api(COMMONS, {"action": "query", "list": "categorymembers", "cmtitle": "Category:" + cat,
                          "cmtype": "file", "cmlimit": 500, **cont})
        out += [m["title"] for m in d["query"]["categorymembers"]]
        if "continue" not in d:
            break
        cont = d["continue"]
    return out


def image_infos(titles: list[str]) -> list[dict]:
    res = []
    for i in range(0, len(titles), 50):
        d = api(COMMONS, {
            "action": "query", "titles": "|".join(titles[i:i + 50]), "prop": "imageinfo",
            "iiprop": "size|mime|url|extmetadata",
            "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl|ImageDescription|DateTimeOriginal|Credit|Attribution",
        })
        for page in d.get("query", {}).get("pages", {}).values():
            if "imageinfo" in page:
                ii = page["imageinfo"][0]
                meta = {k: v.get("value", "") for k, v in ii.get("extmetadata", {}).items()}
                res.append({"title": page["title"], "width": ii["width"], "height": ii["height"], "mime": ii["mime"],
                            "page": ii["descriptionurl"], "meta": meta})
    return res


def score(c: dict) -> float | None:
    """None when the file is out (license, format, size, not a plain photograph); else higher is better."""
    m = c["meta"]
    if not FREE.match(strip_html(m.get("LicenseShortName", ""))):
        return None
    if c["mime"] not in ("image/jpeg", "image/png", "image/tiff"):
        return None
    if min(c["width"], c["height"]) < 900 or max(c["width"], c["height"]) < 1200:
        return None
    desc = strip_html(m.get("ImageDescription", ""))
    if EXCLUDE_TITLE.search(c["title"]) or EXCLUDE_DESC.search(desc[:400]):
        return None
    artist = m.get("Artist", "")
    s = math.log10(c["width"] * c["height"])
    if "User:" in artist or "flickr" in artist.lower():
        s += 3  # an amateur's own upload
    if re.search(r"nasa|esa|stsci|noirlab|eso\b|jpl", strip_html(artist), re.I):
        s -= 1
    if CAPTURE.search(desc) or CAPTURE.search(c["title"]):
        s += 2
    if c["mime"] == "image/jpeg":
        s += 0.5
    return s


def main() -> None:
    root = workdir()
    targets = load_json(root / "targets.json", None)
    if targets is None:
        sys.exit("No targets.json in the working folder: a list of [catalog id, English Wikipedia article].")
    out_path = root / "candidates.json"
    out = load_json(out_path, {})
    for dso_id, article in targets:
        if dso_id in out:
            continue
        cat, p18 = wikidata_category(article)
        if not cat:
            cat = designation_category(dso_id)
        print(dso_id, article, "->", cat, flush=True)
        titles = category_files(cat) if cat else []
        if p18 and "File:" + p18 not in titles:
            titles.append("File:" + p18)
        keep = []
        for s, c in sorted(((score(c), c) for c in image_infos(titles)), key=lambda t: -(t[0] or -1)):
            if s is None:
                continue
            c.update(score=round(s, 2), license=strip_html(c["meta"].get("LicenseShortName", "")),
                     artist=strip_html(c["meta"].get("Artist", "")))
            keep.append(c)
            if len(keep) == 5:
                break
        out[dso_id] = {"article": article, "category": cat, "candidates": keep}
        print(f"   kept {len(keep)}", flush=True)
        save_json(out_path, out)


if __name__ == "__main__":
    main()
