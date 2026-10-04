"""
Download 20 real NYT crosswords from the doshea/nyt_crosswords GitHub repo.

The repo contains standard 15x15 puzzles organised as:
  /{YYYY}/{MM}/{DD}.json

Usage:
  python download_puzzles.py          # download 20 puzzles
  python download_puzzles.py --n 30   # download 30
"""
import argparse
import json
import time
import urllib.request
import urllib.error
import sys
from pathlib import Path

BASE_RAW = "https://raw.githubusercontent.com/doshea/nyt_crosswords/master"
BASE_API = "https://api.github.com/repos/doshea/nyt_crosswords/contents"
OUT_DIR = Path(__file__).parent.parent / "data" / "puzzles"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Pre-confirmed dates that exist in the repo (sampled from 2017 and 2018)
KNOWN_DATES = [
    ("2017", "01", "04"), ("2017", "02", "01"), ("2017", "02", "02"),
    ("2017", "02", "08"), ("2017", "02", "13"), ("2017", "03", "01"),
    ("2017", "03", "02"), ("2017", "03", "03"), ("2017", "03", "06"),
    ("2017", "03", "09"), ("2017", "03", "13"), ("2017", "03", "14"),
    ("2018", "03", "09"),
    # additional from 2017 Q2 and Q3
    ("2017", "04", "03"), ("2017", "04", "04"), ("2017", "04", "05"),
    ("2017", "04", "06"), ("2017", "04", "07"), ("2017", "04", "10"),
    ("2017", "04", "11"), ("2017", "04", "12"), ("2017", "04", "13"),
    ("2017", "04", "14"), ("2017", "04", "17"), ("2017", "04", "18"),
    ("2017", "05", "01"), ("2017", "05", "02"), ("2017", "05", "03"),
    ("2017", "05", "04"), ("2017", "05", "05"), ("2017", "12", "01"),
    ("2017", "12", "04"), ("2017", "12", "05"), ("2017", "12", "06"),
    ("2017", "12", "07"), ("2017", "12", "08"),
]


def fetch_via_api_raw(year: str, month: str, day: str) -> dict | None:
    """
    Use the GitHub API with Accept: application/vnd.github.v3.raw header
    to get the raw file content in a single request.
    """
    url = f"{BASE_API}/{year}/{month}/{day}.json"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github.v3.raw"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except Exception as e:
        print(f"  warn: {year}/{month}/{day}: {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=20)
    args = parser.parse_args()
    target = args.n

    saved = 0
    tried = 0

    for year, month, day in KNOWN_DATES:
        if saved >= target:
            break
        tried += 1
        stem = f"{year}-{month}-{day}"
        out_path = OUT_DIR / f"{stem}.json"

        if out_path.exists():
            print(f"  skip (exists): {out_path.name}")
            saved += 1
            continue

        data = fetch_via_api_raw(year, month, day)
        if data is None:
            print(f"  miss: {year}/{month}/{day}")
            continue

        rows = data.get("size", {}).get("rows", 0)
        cols = data.get("size", {}).get("cols", 0)
        title = data.get("title", stem)

        out_path.write_text(json.dumps(data, indent=2))
        print(f"  saved: {out_path.name}  ({rows}x{cols})  {title}")
        saved += 1

        # Be polite to GitHub's unauthenticated rate limit (60 req/min)
        time.sleep(0.5)

    print(f"\nTotal: {saved}/{target} puzzles in {OUT_DIR}")


if __name__ == "__main__":
    main()
