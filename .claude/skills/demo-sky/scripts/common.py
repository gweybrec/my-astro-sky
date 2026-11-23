"""Shared helpers of the demo-sky scripts: the working folder, the solver, Wikimedia requests and the state files.

Nothing here names a folder of any machine: the working folder and the solver are given by the environment.

  DEMO_SKY_DIR              the working folder (required): downloads, solves, state files and packages go there
  SOLVE_FIELD_PATH          the solve-field command (default: solve-field), as the app's setting of the same name
  USE_WSL_FOR_SOLVE_FIELD   1/true on Windows to run solve-field inside WSL, as the app's setting of the same name
  SOLVE_FIELD_INDEX_DIRS    extra index folders, as the solver sees them, separated by ';' (optional)
  WIKIMEDIA_CONTACT         contact for the Wikimedia User-Agent (default: the repository's https remote)
"""
import html
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]


def workdir() -> Path:
    value = os.environ.get("DEMO_SKY_DIR", "").strip()
    if not value:
        sys.exit("Set DEMO_SKY_DIR to the working folder (outside the repository, or git-ignored).")
    path = Path(value).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


# ---- state files -------------------------------------------------------------------------------------------------

def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def load_state(root: Path) -> dict:
    state = load_json(root / "solved.json", {})
    state.setdefault("solved", {})
    state.setdefault("failed", {})
    state.setdefault("rejected", [])
    return state


def catalog() -> dict:
    """The app's DSO catalog, by id."""
    d = json.loads((REPO / "public/data/dso.json").read_text(encoding="utf-8"))
    fields = d["fields"]
    return {row[0]: dict(zip(fields, row)) for row in d["data"]}


# ---- Wikimedia -----------------------------------------------------------------------------------------------------

def _contact() -> str:
    value = os.environ.get("WIKIMEDIA_CONTACT", "").strip()
    if value:
        return value
    try:
        url = subprocess.run(["git", "-C", str(REPO), "remote", "get-url", "origin"],
                             capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        url = ""
    if url.startswith("https://"):
        return url.removesuffix(".git")
    sys.exit("Set WIKIMEDIA_CONTACT (a project URL): Wikimedia blocks automated requests without contact details.")


USER_AGENT = None
_last_call = 0.0
_api_lock = threading.Lock()


def user_agent() -> dict:
    global USER_AGENT
    if USER_AGENT is None:
        USER_AGENT = {"User-Agent": f"MyAstroSkyDemoBuilder/1.0 ({_contact()}) python-urllib"}
    return USER_AGENT


def api(url: str, params: dict) -> dict:
    """A MediaWiki API call, at most one per second, retried on network errors."""
    global _last_call
    with _api_lock:
        wait = 1.0 - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
    query = url + "?" + urllib.parse.urlencode({**params, "format": "json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(query, headers=user_agent()), timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            print("  retry", attempt, e, file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(query)


COMMONS = "https://commons.wikimedia.org/w/api.php"
WIKIDATA = "https://www.wikidata.org/w/api.php"


def strip_html(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", s or "")).strip()


# ---- solve-field -----------------------------------------------------------------------------------------------

def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def use_wsl() -> bool:
    return sys.platform == "win32" and _truthy(os.environ.get("USE_WSL_FOR_SOLVE_FIELD"))


def solver_path(path: Path) -> str:
    """A local path as the solver sees it (C:\\x\\y -> /mnt/c/x/y inside WSL), as server/wsl-utils.ts does."""
    s = str(path.resolve())
    if not use_wsl():
        return s
    m = re.match(r"^([a-zA-Z]):[\\/](.*)$", s)
    return f"/mnt/{m[1].lower()}/{m[2].replace(chr(92), '/')}" if m else s


def run_solver(args: list[str], limit_s: int) -> tuple[int, str]:
    """Runs solve-field with `args`; returns (exit code, output). Past `limit_s` it is stopped with its helper
    processes: inside WSL by `timeout` (killing wsl.exe alone leaves the solve running there), elsewhere by
    stopping its process group. Exit code 124 means the limit was reached."""
    binary = os.environ.get("SOLVE_FIELD_PATH", "").strip() or "solve-field"
    if use_wsl():
        cmd = ["wsl", "-e", "timeout", str(limit_s), binary, *args]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=limit_s + 60)
            return p.returncode, p.stdout + p.stderr
        except subprocess.TimeoutExpired:
            return 124, ""
    posix = os.name == "posix"
    p = subprocess.Popen([binary, *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         start_new_session=posix)
    try:
        out, _ = p.communicate(timeout=limit_s)
        return p.returncode, out
    except subprocess.TimeoutExpired:
        if posix:
            import signal
            os.killpg(p.pid, signal.SIGKILL)
        else:
            p.kill()
        p.communicate()
        return 124, ""


def solver_config(root: Path) -> Path:
    """A solve-field config listing the default index folder and SOLVE_FIELD_INDEX_DIRS; written in the working folder."""
    extra = [d.strip() for d in os.environ.get("SOLVE_FIELD_INDEX_DIRS", "").split(";") if d.strip()]
    lines = ["cpulimit 300", "add_path /usr/share/astrometry", *[f"add_path {d}" for d in extra], "autoindex", ""]
    path = root / "astrometry-demo.cfg"
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return path
