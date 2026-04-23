#!/usr/bin/env python3
"""
Generate content/chat-context/disaster_damages.json from S3 label JSON files.

Expected label filename pattern:
  <disaster-prefix>_<patch-id>_(pre|post)_disaster.json

Damage subtype counts are computed from POST-disaster label files only.
"""

import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Dict, Iterable, Optional, Tuple

try:
    import boto3
except ImportError:
    boto3 = None


def _load_env_file(path: str) -> None:
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
    val = (bucket_value or "").strip()
    if val.startswith("arn:aws:s3:::"):
        return val.split(":::", 1)[1].strip()
    return val


def _normalize_prefix(prefix: str) -> str:
    return prefix.strip().strip("/")


def _iter_s3_keys(s3_client, bucket: str, prefix: str) -> Iterable[str]:
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
    match = re.match(r"(.+?)_(\d+)_(pre|post)_disaster\.json$", label_filename)
    if not match:
        return None
    return match.group(1), match.group(2), match.group(3)


def _normalize_subtype(raw_subtype: str) -> str:
    val = (raw_subtype or "").strip().lower()
    if val in {"no-damage", "minor-damage", "major-damage", "destroyed"}:
        return val
    return "un-classified"


def main() -> None:
    if boto3 is None:
        print("ERROR: boto3 is required. Install with: pip install boto3")
        return

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    _load_env_file(os.path.join(repo_root, ".env.local"))

    s3_bucket = _normalize_bucket_name(os.environ.get("S3_BUCKET", ""))
    s3_labels_prefix = _normalize_prefix(os.environ.get("S3_LABELS_PREFIX", "labels"))
    disaster_prefix_filter = os.environ.get("DATASET_DISASTER_PREFIX", "").strip()
    output_path = os.path.join(script_dir, "chat-context", "disaster_damages.json")

    if not s3_bucket:
        print("ERROR: S3_BUCKET is required")
        return

    s3_client = boto3.client("s3")

    all_keys = [
        key for key in _iter_s3_keys(s3_client, s3_bucket, s3_labels_prefix)
        if key.endswith(".json")
    ]
    post_label_keys = []

    for key in sorted(all_keys):
        filename = os.path.basename(key)
        parsed = _parse_label_name(filename)
        if not parsed:
            continue
        disaster_prefix, _, timing = parsed
        if timing != "post":
            continue
        if disaster_prefix_filter and disaster_prefix != disaster_prefix_filter:
            continue
        post_label_keys.append((key, disaster_prefix))

    if not post_label_keys:
        print(
            f"ERROR: No matching post-disaster labels found in "
            f"s3://{s3_bucket}/{s3_labels_prefix}"
        )
        return

    subtype_counter = Counter()
    building_total = 0
    patch_count = 0
    disaster_values = set()

    for key, disaster_prefix in post_label_keys:
        disaster_values.add(disaster_prefix)
        patch_count += 1
        try:
            response = s3_client.get_object(Bucket=s3_bucket, Key=key)
            data = json.loads(response["Body"].read().decode("utf-8"))
            features = data.get("features", {}).get("lng_lat", [])
            for feat in features:
                subtype = _normalize_subtype(feat.get("properties", {}).get("subtype", ""))
                subtype_counter[subtype] += 1
                building_total += 1
        except Exception:
            # Keep going even if one label file fails.
            continue

    if disaster_prefix_filter:
        disaster_name = disaster_prefix_filter
    elif len(disaster_values) == 1:
        disaster_name = next(iter(disaster_values))
    else:
        disaster_name = "multiple-disasters"

    payload: Dict = {
        "disaster": disaster_name,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": f"S3 labels from s3://{s3_bucket}/{s3_labels_prefix}",
        "summary": {
            "total_buildings_assessed": building_total,
            "no_damage": subtype_counter.get("no-damage", 0),
            "minor_damage": subtype_counter.get("minor-damage", 0),
            "major_damage": subtype_counter.get("major-damage", 0),
            "destroyed": subtype_counter.get("destroyed", 0),
            "un_classified": subtype_counter.get("un-classified", 0),
        },
        "metadata": {
            "patches_counted": patch_count,
            "labels_used": "post_disaster",
            "disaster_prefix_filter": disaster_prefix_filter or None,
        },
        "notes": [
            "Counts are aggregated from post-disaster label features.lng_lat[*].properties.subtype.",
            "If a label file could not be read, it is skipped.",
        ],
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"Disaster damage summary written: {output_path}")
    print(f"  Disaster: {payload['disaster']}")
    print(f"  Post-disaster patches counted: {patch_count}")
    print(f"  Buildings assessed: {building_total}")
    print(
        "  Subtype counts: "
        f"no={payload['summary']['no_damage']}, "
        f"minor={payload['summary']['minor_damage']}, "
        f"major={payload['summary']['major_damage']}, "
        f"destroyed={payload['summary']['destroyed']}, "
        f"un_classified={payload['summary']['un_classified']}"
    )


if __name__ == "__main__":
    main()
