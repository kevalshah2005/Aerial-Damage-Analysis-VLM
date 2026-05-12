#!/usr/bin/env python3
"""
Generates a spatial manifest from xview_geotransforms.json and labels in S3.
Uses proper georeferencing data from the original geotiffs.
Outputs content/manifest.json with accurate bounds for each patch pair.
Includes CloudFront URLs for images and labels when NEXT_PUBLIC_CLOUDFRONT_URL is set.
"""

import os
import json
import re
from typing import Dict, List, Optional, Tuple

try:
    import boto3
except ImportError:
    boto3 = None


def _load_env_file(path: str) -> None:
    """
    Minimal .env loader for KEY=VALUE lines.
    Only sets variables that are not already present in the environment.
    """
    if not os.path.isfile(path):
        return

    with open(path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def _normalize_bucket_name(bucket_value: str) -> str:
    """
    Accept plain bucket names or s3 bucket ARNs.
    Example ARN: arn:aws:s3:::aerial-damage-images
    """
    val = (bucket_value or "").strip()
    if not val:
        return ""
    if val.startswith("arn:aws:s3:::"):
        return val.split(":::", 1)[1].strip()
    return val


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


def _normalize_prefix(prefix: str) -> str:
    clean = prefix.strip().strip("/")
    return clean


def _iter_s3_keys(s3_client, bucket: str, prefix: str):
    paginator = s3_client.get_paginator("list_objects_v2")
    kwargs = {"Bucket": bucket}
    if prefix:
        kwargs["Prefix"] = f"{prefix}/"

    for page in paginator.paginate(**kwargs):
        for obj in page.get("Contents", []):
            key = obj.get("Key", "")
            if key:
                yield key


def _parse_label_name(label_filename: str) -> Optional[Tuple[str, str, str]]:
    """
    Expected: <disaster-prefix>_<patch-id>_(pre|post)_disaster.json
    """
    match = re.match(r"(.+?)_(\d+)_(pre|post)_disaster\.json$", label_filename)
    if not match:
        return None
    return match.group(1), match.group(2), match.group(3)


def _get_geotransform_entry(
    geotransforms: Dict,
    image_filename: str,
    geotransform_image_extension: str,
) -> Optional[List]:
    # Primary lookup using the actual image filename.
    entry = geotransforms.get(image_filename)
    if entry:
        return entry

    # Fallback for cases where geotransforms still use .png while imagery is .webp.
    if geotransform_image_extension and image_filename.endswith(".webp"):
        png_key = image_filename[:-5] + f".{geotransform_image_extension}"
        return geotransforms.get(png_key)

    return None


def main():
    if boto3 is None:
        print("ERROR: boto3 is required. Install with: pip install boto3")
        return

    # Load .env.local from repo root for local script runs.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    _load_env_file(os.path.join(repo_root, ".env.local"))

    # Runtime config
    cloudfront_url = os.environ.get('NEXT_PUBLIC_CLOUDFRONT_URL', '')
    s3_bucket = _normalize_bucket_name(os.environ.get("S3_BUCKET", ""))
    disaster_prefix_filter = os.environ.get("DATASET_DISASTER_PREFIX", "").strip()
    image_extension = os.environ.get("DATASET_IMAGE_EXTENSION", "webp").strip().lstrip(".").lower()
    geotransform_image_extension = os.environ.get(
        "GEOTRANSFORM_IMAGE_EXTENSION", "png"
    ).strip().lstrip(".").lower()
    s3_labels_prefix = _normalize_prefix(os.environ.get("S3_LABELS_PREFIX", "labels"))
    s3_images_prefix = _normalize_prefix(os.environ.get("S3_IMAGES_PREFIX", "images"))

    geotransforms_path = os.path.join(script_dir, "xview_geotransforms.json")
    manifest_path = os.path.join(script_dir, "manifest.json")

    if not os.path.isfile(geotransforms_path):
        print(f"ERROR: Geotransforms file not found: {geotransforms_path}")
        return

    if not s3_bucket:
        print("ERROR: S3_BUCKET is required")
        return

    if not cloudfront_url:
        print("ERROR: NEXT_PUBLIC_CLOUDFRONT_URL is required for manifest URL generation")
        return

    with open(geotransforms_path, "r") as f:
        geotransforms = json.load(f)

    s3_client = boto3.client("s3")

    IMAGE_WIDTH = 1024
    IMAGE_HEIGHT = 1024

    patches: Dict[str, Dict] = {}
    label_json_keys = [
        key for key in _iter_s3_keys(s3_client, s3_bucket, s3_labels_prefix)
        if key.endswith(".json")
    ]

    if not label_json_keys:
        print(
            f"ERROR: No label JSON files found in s3://{s3_bucket}/"
            f"{s3_labels_prefix or ''}"
        )
        return

    for label_key in sorted(label_json_keys):
        label_filename = os.path.basename(label_key)
        parsed = _parse_label_name(label_filename)
        if not parsed:
            continue
        disaster_prefix, patch_id, timing = parsed
        if disaster_prefix_filter and disaster_prefix != disaster_prefix_filter:
            continue
        if patch_id not in patches:
            patches[patch_id] = {"disasterPrefix": disaster_prefix}
        patches[patch_id][timing] = {
            "filename": label_filename,
            "key": label_key,
        }

    manifest_patches = []
    global_bounds = [180, 90, -180, -90]

    for patch_id in sorted(patches.keys()):
        entry = patches[patch_id]
        pre_file = entry.get("pre")
        post_file = entry.get("post")
        disaster_prefix = entry.get("disasterPrefix")

        if not pre_file or not post_file:
            print(f"  SKIP {patch_id}: missing pre or post file")
            continue

        pre_filename = f"{disaster_prefix}_{patch_id}_pre_disaster.{image_extension}"
        post_filename = f"{disaster_prefix}_{patch_id}_post_disaster.{image_extension}"

        pre_gt_data = _get_geotransform_entry(
            geotransforms,
            pre_filename,
            geotransform_image_extension,
        )
        post_gt_data = _get_geotransform_entry(
            geotransforms,
            post_filename,
            geotransform_image_extension,
        )

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
        for label_meta in [pre_file, post_file]:
            try:
                response = s3_client.get_object(Bucket=s3_bucket, Key=label_meta["key"])
                data = json.loads(response["Body"].read().decode("utf-8"))
                lng_lat_features = data.get("features", {}).get("lng_lat", [])
                total_buildings = max(total_buildings, len(lng_lat_features))
            except Exception:
                pass

        global_bounds = merge_bounds(global_bounds, patch_bounds)

        leaflet_bounds = [
            [patch_bounds[1], patch_bounds[0]],
            [patch_bounds[3], patch_bounds[2]],
        ]

        # Build CloudFront URLs if configured
        cloudfront_url = cloudfront_url.rstrip('/')
        pre_url = f"{cloudfront_url}/{s3_images_prefix}/{pre_filename}"
        post_url = f"{cloudfront_url}/{s3_images_prefix}/{post_filename}"
        pre_json_url = f"{cloudfront_url}/{pre_file['key']}"
        post_json_url = f"{cloudfront_url}/{post_file['key']}"

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
    print(f"  S3 Bucket: {s3_bucket}")
    if disaster_prefix_filter:
        print(f"  Dataset Filter: {disaster_prefix_filter}")
    print(f"  Image Extension: .{image_extension}")
    print(f"  Geotransform Extension Fallback: .{geotransform_image_extension}")
    print(f"  CloudFront URL: {cloudfront_url}")


if __name__ == "__main__":
    main()