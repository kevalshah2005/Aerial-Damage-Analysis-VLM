#!/usr/bin/env python3
"""
Generates a spatial manifest from xview_geotransforms.json.
Uses proper georeferencing data from the original geotiffs.
Outputs content/manifest.json with accurate bounds for each patch pair.
Uses local dataset API URLs and reads dataset files from DATASET_LOCAL_ROOT.
"""

import os
import json
import re

def load_local_env_file(env_path):
    """Load simple KEY=VALUE entries from .env.local into process env."""
    if not os.path.isfile(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()

            if not key or key in os.environ:
                continue

            # Remove matching surrounding quotes.
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]

            os.environ[key] = value


def calculate_bounds_from_geotransform(gt, width, height):
    """
    Calculate bounds from GeoTransform.
    GeoTransform: [xmin, xres, xskew, ymax, yskew, yres]
    Returns [minLng, minLat, maxLng, maxLat]
    """
    xmin, xres, _, ymax, _, yres = gt
    
    min_lng = xmin
    max_lng = xmin + width * xres
    max_lat = ymax
    min_lat = ymax + height * yres
    
    return [min_lng, min_lat, max_lng, max_lat]


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
    env_path = os.path.join(os.path.dirname(script_dir), ".env.local")
    load_local_env_file(env_path)

    dataset_local_root = os.environ.get('DATASET_LOCAL_ROOT', '')

    geotransforms_path = os.path.join(script_dir, "xview_geotransforms.json")
    if dataset_local_root and not os.path.isabs(dataset_local_root):
        print("ERROR: DATASET_LOCAL_ROOT must be an absolute path")
        return
    labels_dir = os.path.join(dataset_local_root, "labels") if dataset_local_root else ""
    manifest_path = os.path.join(script_dir, "manifest.json")

    if not os.path.isfile(geotransforms_path):
        print(f"ERROR: Geotransforms file not found: {geotransforms_path}")
        return

    if not dataset_local_root:
        print("ERROR: DATASET_LOCAL_ROOT is required for local manifest generation")
        return

    if not os.path.isdir(labels_dir):
        print(f"ERROR: Labels directory not found under DATASET_LOCAL_ROOT: {labels_dir}")
        return

    with open(geotransforms_path, "r") as f:
        geotransforms = json.load(f)

    IMAGE_WIDTH = 1024
    IMAGE_HEIGHT = 1024

    patches = {}
    for f in sorted(os.listdir(labels_dir)):
        if not f.endswith(".json"):
            continue
        match = re.match(r'(.+?)_(\d+)_(pre|post)_disaster\.json', f)
        if not match:
            continue
        disaster = match.group(1)
        patch_id = match.group(2)
        timing = match.group(3)
        patch_key = f"{disaster}_{patch_id}"
        if patch_key not in patches:
            patches[patch_key] = {"disaster": disaster, "patchId": patch_id}
        patches[patch_key][timing] = f

    manifest_patches = []
    global_bounds = [180, 90, -180, -90]

    for patch_key in sorted(patches.keys()):
        entry = patches[patch_key]
        disaster = entry.get("disaster")
        patch_id = entry.get("patchId")
        pre_file = entry.get("pre")
        post_file = entry.get("post")

        if not pre_file or not post_file:
            print(f"  SKIP {patch_key}: missing pre or post file")
            continue

        pre_filename = f"{disaster}_{patch_id}_pre_disaster.png"
        post_filename = f"{disaster}_{patch_id}_post_disaster.png"

        pre_gt_data = geotransforms.get(pre_filename)
        post_gt_data = geotransforms.get(post_filename)

        if not pre_gt_data:
            print(f"  SKIP {patch_key}: no geotransform for {pre_filename}")
            continue

        pre_bounds = calculate_bounds_from_geotransform(pre_gt_data[0], IMAGE_WIDTH, IMAGE_HEIGHT)

        if post_gt_data:
            post_bounds = calculate_bounds_from_geotransform(post_gt_data[0], IMAGE_WIDTH, IMAGE_HEIGHT)
            patch_bounds = merge_bounds(pre_bounds, post_bounds)
        else:
            patch_bounds = pre_bounds

        total_buildings = 0
        for fname in [pre_file, post_file]:
            fpath = os.path.join(labels_dir, fname)
            try:
                with open(fpath, "r") as f:
                    data = json.load(f)
                lng_lat_features = data.get("features", {}).get("lng_lat", [])
                total_buildings = max(total_buildings, len(lng_lat_features))
            except:
                pass

        global_bounds = merge_bounds(global_bounds, patch_bounds)

        leaflet_bounds = [
            [patch_bounds[1], patch_bounds[0]],
            [patch_bounds[3], patch_bounds[2]],
        ]

        pre_url = f"/api/dataset/image/{pre_filename}"
        post_url = f"/api/dataset/image/{post_filename}"
        pre_json_url = f"/api/dataset/label/{pre_file}"
        post_json_url = f"/api/dataset/label/{post_file}"

        manifest_patches.append({
            "id": patch_key,
            "pre": pre_url,
            "post": post_url,
            "preJson": pre_json_url,
            "postJson": post_json_url,
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
    print(f"  Dataset local root: {dataset_local_root}")
    print("  URL mode: local API routes")


if __name__ == "__main__":
    main()