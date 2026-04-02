#!/usr/bin/env python3
"""
Generates a spatial manifest from harvey-geo/labels/*.json files.
Outputs content/manifest.json with bounds for each patch pair.
"""

import os
import json
import re
import glob


def parse_wkt_bounds(wkt: str):
    """Extract [minLng, minLat, maxLng, maxLat] from a WKT POLYGON."""
    match = re.search(r'\(\((.*?)\)\)', wkt)
    if not match:
        return None
    points = match.group(1).split(',')
    lngs, lats = [], []
    for pt in points:
        parts = pt.strip().split()
        if len(parts) >= 2:
            lngs.append(float(parts[0]))
            lats.append(float(parts[1]))
    if not lngs:
        return None
    return [min(lngs), min(lats), max(lngs), max(lats)]


def merge_bounds(a, b):
    """Merge two [minLng, minLat, maxLng, maxLat] bounds."""
    return [
        min(a[0], b[0]),
        min(a[1], b[1]),
        max(a[2], b[2]),
        max(a[3], b[3]),
    ]


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    labels_dir = os.path.join(script_dir, "harvey-geo", "labels")
    manifest_path = os.path.join(script_dir, "manifest.json")

    if not os.path.isdir(labels_dir):
        print(f"ERROR: Labels directory not found: {labels_dir}")
        return

    # Group files by patch ID
    # Pattern: hurricane-harvey_{ID}_{pre|post}_disaster.json
    patches = {}
    for f in sorted(os.listdir(labels_dir)):
        if not f.endswith(".json"):
            continue
        match = re.match(r'hurricane-harvey_(\d+)_(pre|post)_disaster\.json', f)
        if not match:
            continue
        patch_id = match.group(1)
        timing = match.group(2)  # 'pre' or 'post'
        if patch_id not in patches:
            patches[patch_id] = {}
        patches[patch_id][timing] = f

    manifest_patches = []
    global_bounds = [180, 90, -180, -90]  # [minLng, minLat, maxLng, maxLat]

    for patch_id in sorted(patches.keys()):
        entry = patches[patch_id]
        pre_file = entry.get("pre")
        post_file = entry.get("post")

        if not pre_file or not post_file:
            print(f"  SKIP {patch_id}: missing pre or post file")
            continue

        # Parse bounds from both pre and post JSON files
        patch_bounds = None
        total_buildings = 0

        for fname in [pre_file, post_file]:
            fpath = os.path.join(labels_dir, fname)
            try:
                with open(fpath, "r") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"  WARN: cannot read {fname}: {e}")
                continue

            lng_lat_features = data.get("features", {}).get("lng_lat", [])
            total_buildings = max(total_buildings, len(lng_lat_features))

            for feat in lng_lat_features:
                wkt = feat.get("wkt", "")
                b = parse_wkt_bounds(wkt)
                if b:
                    if patch_bounds is None:
                        patch_bounds = b
                    else:
                        patch_bounds = merge_bounds(patch_bounds, b)

        if patch_bounds is None:
            print(f"  SKIP {patch_id}: no valid bounds found")
            continue

        # Update global bounds
        global_bounds = merge_bounds(global_bounds, patch_bounds)

        # Convert bounds to [[minLat, minLng], [maxLat, maxLng]] for Leaflet
        leaflet_bounds = [
            [patch_bounds[1], patch_bounds[0]],
            [patch_bounds[3], patch_bounds[2]],
        ]

        manifest_patches.append({
            "id": patch_id,
            "pre": f"hurricane-harvey_{patch_id}_pre_disaster.png",
            "post": f"hurricane-harvey_{patch_id}_post_disaster.png",
            "preJson": f"hurricane-harvey_{patch_id}_pre_disaster.json",
            "postJson": f"hurricane-harvey_{patch_id}_post_disaster.json",
            "bounds": leaflet_bounds,
            "buildingCount": total_buildings,
        })

    manifest = {
        "patches": manifest_patches,
        "totalBounds": [
            [global_bounds[1], global_bounds[0]],
            [global_bounds[3], global_bounds[2]],
        ],
        "count": len(manifest_patches),
    }

    with open(manifest_path, "w") as f:
        json.dump(manifest, f)

    print(f"Manifest written: {manifest_path}")
    print(f"  Patches: {len(manifest_patches)}")
    print(f"  Total bounds: {manifest['totalBounds']}")


if __name__ == "__main__":
    main()
