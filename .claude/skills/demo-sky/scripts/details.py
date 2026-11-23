"""The Commons page of each solved photo, to read its author, license and capture details.

Usage: python -P -E -X utf8 details.py <command>
  fetch                  fetches the pages of solved photos not fetched yet (or whose image changed); details.json
  show [ID,ID...]        prints the useful part of the pages (default: the photos without an entry in entries.json)
"""
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the repository
sys.path.insert(0, str(Path(__file__).resolve().parent))  # -P keeps the script's folder off the path
from common import COMMONS, api, load_json, load_state, save_json, strip_html, workdir  # noqa: E402

PROCESSING = re.compile(r"(?is)\n\s*(image processing|traitement|pixinsight:|preprocessing|processing\b).*")


def fetch(root: Path) -> None:
    state = load_state(root)
    path = root / "details.json"
    details = load_json(path, {})
    for dso_id, s in state["solved"].items():
        if details.get(dso_id, {}).get("title") == s["title"]:
            continue
        d = api(COMMONS, {"action": "query", "titles": s["title"], "prop": "revisions", "rvprop": "content",
                          "rvslots": "main"})
        page = next(iter(d["query"]["pages"].values()))
        m = s["candidate"]["meta"]
        details[dso_id] = {
            "title": s["title"], "page": s["candidate"]["page"],
            "artist": strip_html(m.get("Artist", "")), "license": strip_html(m.get("LicenseShortName", "")),
            "licenseUrl": m.get("LicenseUrl", ""), "date": strip_html(m.get("DateTimeOriginal", "")),
            "credit": strip_html(m.get("Credit", "")),
            "description": strip_html(m.get("ImageDescription", ""))[:3000],
            "wikitext": re.sub(r"\n{3,}", "\n\n", page["revisions"][0]["slots"]["main"]["*"])[:8000],
            "fieldDeg": s["fieldDeg"],
        }
        print(dso_id, s["title"], flush=True)
        save_json(path, details)


def show(root: Path, keys: list[str] | None) -> None:
    details = load_json(root / "details.json", {})
    if keys is None:
        entries = load_json(root / "entries.json", {})
        keys = [k for k in load_state(root)["solved"] if k not in entries]
    for k in keys:
        v = details.get(k)
        if not v:
            print(f"##### {k}: not fetched (run details.py fetch)")
            continue
        lines = [line for line in v["wikitext"].splitlines()
                 if line.strip() and not line.startswith(("[[Category", "{{Assessment", "=={{int:license", "{{self"))
                 and "Flickreview" not in line]
        print(f"##### {k} | {v['title']} | license={v['license']} | artist={v['artist'][:80]} | "
              f"date={v['date'][:40]} | field={v['fieldDeg']}")
        print(PROCESSING.sub("", "\n".join(lines))[:2500])
        print()


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = workdir()
    if sys.argv[1] == "fetch":
        fetch(root)
    elif sys.argv[1] == "show":
        show(root, sys.argv[2].split(",") if len(sys.argv) > 2 else None)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
