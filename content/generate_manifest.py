#!/usr/bin/env python3
"""
Generates a spatial manifest from xview_geotransforms.json.
Uses proper georeferencing data from the original geotiffs.
Outputs content/manifest.json with accurate bounds for each patch pair.
Includes CloudFront URLs for images and labels when NEXT_PUBLIC_CLOUDFRONT_URL is set.
"""

import os
import json
import re


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
    # Get CloudFront URL from environment variable
    cloudfront_url = os.environ.get('NEXT_PUBLIC_CLOUDFRONT_URL', '')
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    geotransforms_path = os.path.join(script_dir, "xview_geotransforms.json")
    labels_dir = os.path.join(script_dir, "harvey-geo", "labels")
    manifest_path = os.path.join(script_dir, "manifest.json")

    if not os.path.isfile(geotransforms_path):
        print(f"ERROR: Geotransforms file not found: {geotransforms_path}")
        return

    if not os.path.isdir(labels_dir):
        print(f"ERROR: Labels directory not found: {labels_dir}")
        return

    with open(geotransforms_path, "r") as f:
        geotransforms = json.load(f)

    IMAGE_WIDTH = 1024
    IMAGE_HEIGHT = 1024

    patches = {}
    for f in sorted(os.listdir(labels_dir)):
        if not f.endswith(".json"):
            continue
        match = re.match(r'hurricane-harvey_(\d+)_(pre|post)_disaster\.json', f)
        if not match:
            continue
        patch_id = match.group(1)
        timing = match.group(2)
        if patch_id not in patches:
            patches[patch_id] = {}
        patches[patch_id][timing] = f

    manifest_patches = []
    global_bounds = [180, 90, -180, -90]

    for patch_id in sorted(patches.keys()):
        entry = patches[patch_id]
        pre_file = entry.get("pre")
        post_file = entry.get("post")

        if not pre_file or not post_file:
            print(f"  SKIP {patch_id}: missing pre or post file")
            continue

        pre_filename = f"hurricane-harvey_{patch_id}_pre_disaster.png"
        post_filename = f"hurricane-harvey_{patch_id}_post_disaster.png"

        pre_gt_data = geotransforms.get(pre_filename)
        post_gt_data = geotransforms.get(post_filename)

        if not pre_gt_data:
            print(f"  SKIP {patch_id}: no geotransform for {pre_filename}")
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

        # Build CloudFront URLs if configured
        if cloudfront_url:
            # Remove trailing slash if present
            cloudfront_url = cloudfront_url.rstrip('/')
            pre_url = f"{cloudfront_url}/images/{pre_filename}"
            post_url = f"{cloudfront_url}/images/{post_filename}"
            pre_json_url = f"{cloudfront_url}/labels/{pre_file}"
            post_json_url = f"{cloudfront_url}/labels/{post_file}"
        else:
            # Fallback to local paths (for development without S3)
            pre_url = pre_filename
            post_url = post_filename
            pre_json_url = pre_file
            post_json_url = post_file

        manifest_patches.append({
            "id": patch_id,
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
    if cloudfront_url:
        print(f"  CloudFront URL: {cloudfront_url}")
    else:
        print(f"  CloudFront URL: Not set (using local paths)")


if __name__ == "__main__":
    main()