#!/usr/bin/env python3
"""
Generate predicted_patch_summaries.json from model-predicted labels in S3/CloudFront.

Reads manifest.json to get patch bounds, derives predicted label URLs by swapping
the /labels/ prefix for /generated_labels/, fetches each JSON file, and writes
content/chat-context/predicted_patch_summaries.json in the same format as
patch_summaries.json so query_dataset can use it.

Usage:
  python3 content/generate_predicted_summaries.py
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

MANIFEST_PATH = Path(__file__).parent / "manifest.json"
OUT_PATH = Path(__file__).parent / "chat-context" / "predicted_patch_summaries.json"
CONCURRENCY = 12


def predicted_url(post_json: str) -> str:
    return re.sub(r"/labels/", "/generated_labels/", post_json, count=1)


def fetch_json(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"  WARN: {url[-60:]} -> {e}", file=sys.stderr)
        return None


def parse_damage(raw: dict) -> tuple[int, dict[str, int]]:
    """Return (building_count, damage_counts) from xView2-style label JSON."""
    features = raw.get("features", {}).get("lng_lat", [])
    damage: dict[str, int] = {}
    for f in features:
        subtype = (f.get("properties", {}).get("subtype") or "un-classified").strip().lower()
        damage[subtype] = damage.get(subtype, 0) + 1
    return len(features), damage


def process_patch(patch: dict) -> dict | None:
    post_json = patch.get("postJson", "")
    if not post_json:
        return None

    url = predicted_url(post_json)
    raw = fetch_json(url)
    if raw is None:
        return None

    building_count, damage = parse_damage(raw)
    bounds = patch.get("bounds") or patch.get("displayBounds")

    return {
        "id": patch["id"],
        "bounds": bounds,
        "buildingCount": building_count,
        "damage": damage,
    }


def main() -> None:
    if not MANIFEST_PATH.exists():
        sys.exit(f"ERROR: manifest not found at {MANIFEST_PATH}")

    manifest = json.loads(MANIFEST_PATH.read_text())
    patches = manifest.get("patches", [])
    print(f"Processing {len(patches)} patches...")

    results: list[dict] = []
    failed = 0

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(process_patch, p): p["id"] for p in patches}
        for i, future in enumerate(as_completed(futures), 1):
            patch_id = futures[future]
            result = future.result()
            if result:
                results.append(result)
                print(f"  [{i}/{len(patches)}] {patch_id} ok ({result['buildingCount']} buildings)")
            else:
                failed += 1
                print(f"  [{i}/{len(patches)}] {patch_id} SKIP (no data)")

    results.sort(key=lambda r: r["id"])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(results, indent=2))

    print(f"\nWrote {len(results)} patches to {OUT_PATH}")
    if failed:
        print(f"Skipped {failed} patches (no predicted labels or fetch error)")


if __name__ == "__main__":
    main()
