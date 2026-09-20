"""Shared bits for the collectors: HTTP session, data-dir paths, append helpers,
and the git publish step. Everything lands in DATA_DIR (a checkout of the `data`
branch in CI, ./data locally)."""
import json
import os
import subprocess
import time
from datetime import datetime, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(ROOT, "data"))

REST = "https://api.popdex.xyz/api/v1"
EXPLORER = "https://app.popdex.xyz/web/v1/explorer"
WS_PUBLIC = "wss://ws.popdex.xyz/v1/ws/public"
TACHYON_RPC = "https://api.popdex.xyz/api/v1/web3/rpc"

# system accounts (see docs/product-docs/vault + probing)
PROTOCOL_VAULT = "0xffffffffffffffffffffffffffffffffffffffff"
PROTOCOL_MM = "0xfffffffffffffffffffffffffffffffffffffffa"
INSURANCE_FUNDS = [
    "0xfffffffffffffffffffffffffffffffffffffff7",
    "0xfffffffffffffffffffffffffffffffffffffffc",
    "0xfffffffffffffffffffffffffffffffffffffffd",
]

session = requests.Session()
session.headers.update({"User-Agent": "popdex-minor-insights/0.1 (+github.com/eferbarn/PopDex_Minor_Insights)"})


def now_ms():
    return int(time.time() * 1000)


def utc_day(ts_ms=None):
    return datetime.fromtimestamp((ts_ms or now_ms()) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def get(path, base=REST, **params):
    r = session.get(base + path, params=params, timeout=30)
    r.raise_for_status()
    body = r.json()
    if str(body.get("code")) != "200":
        raise RuntimeError(f"{path} -> {body.get('code')} {body.get('msg')}")
    return body


def paginate(path, base=REST, max_pages=50, **params):
    """Cursor pagination used by most list endpoints."""
    out, cursor = [], None
    for _ in range(max_pages):
        body = get(path, base=base, **params, **({"cursor": cursor} if cursor else {}), limit=100)
        rows = body.get("data") or []
        out.extend(rows)
        cursor = body.get("cursor")
        if not rows or not cursor or len(rows) < 100:
            break
    return out


def data_path(*parts):
    p = os.path.join(DATA_DIR, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def append_jsonl(rel, row):
    with open(data_path(rel), "a") as f:
        f.write(json.dumps(row, separators=(",", ":")) + "\n")


def append_jsonl_many(rel, rows):
    if not rows:
        return
    with open(data_path(rel), "a") as f:
        for row in rows:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")


def read_json(rel, default):
    p = os.path.join(DATA_DIR, rel)
    if not os.path.exists(p):
        return default
    with open(p) as f:
        return json.load(f)


def write_json(rel, obj):
    with open(data_path(rel), "w") as f:
        json.dump(obj, f, separators=(",", ":"))


def update_index():
    """index.json = {dir: [YYYY-MM-DD, ...]} so the site knows which day files
    exist instead of probing every day with a 404."""
    idx = {}
    for d in sorted(os.listdir(DATA_DIR)):
        p = os.path.join(DATA_DIR, d)
        if os.path.isdir(p) and not d.startswith("."):
            days = sorted(f[:-6] for f in os.listdir(p) if f.endswith(".jsonl"))
            if days:
                idx[d] = days
    write_json("index.json", {"updated": now_ms(), "days": idx})


def publish(message):
    """Commit + push DATA_DIR to the `data` branch. No-op when nothing changed or
    when not running in CI (PUBLISH=1 forces it)."""
    update_index()
    if not (os.environ.get("GITHUB_ACTIONS") or os.environ.get("PUBLISH")):
        print("[publish] skipped (not in CI)")
        return
    git = lambda *a: subprocess.run(["git", "-C", DATA_DIR, *a], check=True, capture_output=True, text=True)
    git("add", "-A")
    if not subprocess.run(["git", "-C", DATA_DIR, "diff", "--cached", "--quiet"]).returncode:
        print("[publish] nothing to commit")
        return
    git("commit", "-q", "-m", message)
    for attempt in range(6):
        try:
            subprocess.run(["git", "-C", DATA_DIR, "pull", "--rebase", "-q", "origin", "data"], check=False, capture_output=True)
            git("push", "-q", "origin", "HEAD:data")
            print(f"[publish] pushed: {message}")
            return
        except subprocess.CalledProcessError as e:
            print(f"[publish] push failed ({attempt}): {e.stderr.strip()[-200:]}")
            time.sleep(5 + attempt * 5)
    raise RuntimeError("could not push data branch")
