"""
Author: Itay Kadosh
Date: 03/25/2026

Purpose: Crop individual buildings from xView2 pre/post disaster image pairs
         using polygon labels from JSON metadata. Outputs paired PNGs per building
         and a buildings.json manifest with full metadata (polygon, lat/lng, damage
         label, sensor info, etc.) for downstream VLM classification and chatbot use.

Usage:
    python crop_buildings.py --root ~/xview2/test \
        [--out cropped_buildings] \
        [--masked] \
        [--padding 5] \
        [--limit 10] \
        [--sample] \
        [--seed 42]
"""

import os
import json
import argparse
import random
import re
from typing import List, Tuple, Dict, Any, Optional

from PIL import Image, ImageDraw


# ---------------------------------------------------------------------------
# WKT parsing (reused from overlay_labels.py)
# ---------------------------------------------------------------------------

def _parse_ring_text(ring_text: str) -> List[Tuple[float, float]]:
    pts: List[Tuple[float, float]] = []
    for pair in ring_text.split(","):
        pair = pair.strip()
        if not pair:
            continue
        x_str, y_str = pair.split()[:2]
        pts.append((float(x_str), float(y_str)))
    return pts


def parse_wkt_polygon(wkt: str) -> List[List[Tuple[float, float]]]:
    """Parse POLYGON or MULTIPOLYGON WKT into a list of rings."""
    wkt = (wkt or "").strip()
    if not wkt:
        return []

    W = wkt.upper()
    rings: List[List[Tuple[float, float]]] = []

    if W.startswith("POLYGON"):
        inner = wkt[wkt.find("((") + 2 : wkt.rfind("))")]
        for rt in inner.split("), ("):
            rings.append(_parse_ring_text(rt))
        return rings

    if W.startswith("MULTIPOLYGON"):
        inner = wkt[wkt.find("(((") + 3 : wkt.rfind(")))")]
        for poly in inner.split(")), (("):
            for rt in poly.split("), ("):
                rings.append(_parse_ring_text(rt))
        return rings

    return []


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def polygon_bbox(rings: List[List[Tuple[float, float]]]) -> Tuple[float, float, float, float]:
    """Return (x_min, y_min, x_max, y_max) across all rings."""
    all_pts = [pt for ring in rings for pt in ring]
    xs = [p[0] for p in all_pts]
    ys = [p[1] for p in all_pts]
    return min(xs), min(ys), max(xs), max(ys)


def polygon_centroid(rings: List[List[Tuple[float, float]]]) -> Tuple[float, float]:
    """Simple centroid: average of all vertices in the outer ring."""
    pts = rings[0] if rings else []
    if not pts:
        return (0.0, 0.0)
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return cx, cy


def shoelace_area(pts: List[Tuple[float, float]]) -> float:
    """Signed area via shoelace formula (absolute value returned)."""
    n = len(pts)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2.0


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------

LABEL_RE = re.compile(
    r"^(?P<disaster>.+?)_(?P<idx>\d+)_(?P<phase>pre|post)_(?:disaster|diaster)\.json$"
)


def parse_label_filename(fname: str) -> Optional[Dict[str, str]]:
    m = LABEL_RE.match(fname)
    if not m:
        return None
    return m.groupdict()


def scene_id_from_label(fname: str) -> Optional[str]:
    parsed = parse_label_filename(fname)
    if not parsed:
        return None
    return f"{parsed['disaster']}_{parsed['idx']}"


# ---------------------------------------------------------------------------
# Cropping
# ---------------------------------------------------------------------------

def crop_building(
    image: Image.Image,
    rings_px: List[List[Tuple[float, float]]],
    padding: int,
    masked: bool,
) -> Image.Image:
    """Crop a single building from an image.

    Args:
        image: Source PIL image (RGBA).
        rings_px: Polygon rings in pixel coordinates.
        padding: Pixels of padding around the bounding box.
        masked: If True, pixels outside the polygon are black.

    Returns:
        Cropped PIL image (RGB).
    """
    x_min, y_min, x_max, y_max = polygon_bbox(rings_px)

    # clamp to image bounds with padding
    left = max(0, int(x_min) - padding)
    upper = max(0, int(y_min) - padding)
    right = min(image.width, int(x_max) + padding + 1)
    lower = min(image.height, int(y_max) + padding + 1)

    crop = image.crop((left, upper, right, lower))

    if not masked:
        return crop.convert("RGB")

    # build mask from polygon
    mask = Image.new("L", (right - left, lower - upper), 0)
    draw = ImageDraw.Draw(mask)
    for ring in rings_px:
        shifted = [(x - left, y - upper) for x, y in ring]
        if len(shifted) >= 3:
            draw.polygon(shifted, fill=255)

    black_bg = Image.new("RGB", crop.size, (0, 0, 0))
    black_bg.paste(crop.convert("RGB"), mask=mask)
    return black_bg


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Crop individual buildings from xView2 imagery and produce a metadata manifest."
    )
    ap.add_argument("--root", required=True,
                     help="Path to dataset folder containing images/ and labels/")
    ap.add_argument("--out", default="cropped_buildings",
                     help="Output folder (created inside root unless absolute path)")
    ap.add_argument("--masked", action="store_true",
                     help="Mask out pixels outside the building polygon (transparent background)")
    ap.add_argument("--padding", type=int, default=5,
                     help="Pixels of padding around bounding box (default: 5)")
    ap.add_argument("--limit", type=int, default=0,
                     help="Max number of scenes to process (0 = all)")
    ap.add_argument("--sample", action="store_true",
                     help="Randomly sample scenes (requires --limit > 0)")
    ap.add_argument("--seed", type=int, default=42,
                     help="Random seed (default: 42)")
    ap.add_argument("--only", choices=["pre", "post", "both"], default="both",
                     help="Crop from pre, post, or both images (default: both)")

    args = ap.parse_args()

    root = os.path.expanduser(args.root)
    images_dir = os.path.join(root, "images")
    labels_dir = os.path.join(root, "labels")

    if not os.path.isdir(images_dir):
        raise FileNotFoundError(f"Missing images dir: {images_dir}")
    if not os.path.isdir(labels_dir):
        raise FileNotFoundError(f"Missing labels dir: {labels_dir}")

    out_dir = args.out if os.path.isabs(args.out) else os.path.join(root, args.out)
    os.makedirs(out_dir, exist_ok=True)

    # ---- group label files by scene ----
    label_files = [f for f in os.listdir(labels_dir) if f.endswith(".json")]
    scenes: Dict[str, Dict[str, str]] = {}  # scene_id -> {"pre": fname, "post": fname}
    for lf in label_files:
        parsed = parse_label_filename(lf)
        if not parsed:
            continue
        sid = f"{parsed['disaster']}_{parsed['idx']}"
        scenes.setdefault(sid, {})[parsed["phase"]] = lf

    scene_ids = sorted(scenes.keys())
    if not scene_ids:
        raise FileNotFoundError(f"No valid label files found in {labels_dir}")

    # ---- scene selection ----
    if args.sample:
        if args.limit <= 0:
            raise ValueError("--sample requires --limit > 0")
        rng = random.Random(args.seed)
        scene_ids = sorted(rng.sample(scene_ids, k=min(args.limit, len(scene_ids))))
    elif args.limit > 0:
        scene_ids = scene_ids[:args.limit]

    # ---- process scenes ----
    manifest: List[Dict[str, Any]] = []
    total_buildings = 0
    missing = 0

    for sid in scene_ids:
        entry = scenes[sid]

        # we need at least the pre label to get building footprints,
        # and the post label for damage classification
        if "pre" not in entry or "post" not in entry:
            print(f"[WARN] incomplete pair for {sid}, skipping")
            missing += 1
            continue

        # load labels
        pre_json_path = os.path.join(labels_dir, entry["pre"])
        post_json_path = os.path.join(labels_dir, entry["post"])

        with open(pre_json_path, "r", encoding="utf-8") as f:
            pre_data = json.load(f)
        with open(post_json_path, "r", encoding="utf-8") as f:
            post_data = json.load(f)

        # load images (only the phases we need)
        phases_to_crop = ["pre", "post"] if args.only == "both" else [args.only]
        loaded_images: Dict[str, Image.Image] = {}
        skip_scene = False
        for phase in phases_to_crop:
            img_fname = f"{sid}_{phase}_disaster.png"
            img_path = os.path.join(images_dir, img_fname)
            if not os.path.exists(img_path):
                print(f"[WARN] missing image: {img_path}")
                missing += 1
                skip_scene = True
                break
            loaded_images[phase] = Image.open(img_path).convert("RGBA")

        if skip_scene:
            continue

        # build uid -> post properties lookup for damage labels
        post_by_uid: Dict[str, Dict[str, Any]] = {}
        for feat in post_data.get("features", {}).get("xy", []):
            uid = feat.get("properties", {}).get("uid", "")
            if uid:
                post_by_uid[uid] = feat

        # build uid -> lnglat polygon lookup (from pre)
        lnglat_by_uid: Dict[str, List[List[Tuple[float, float]]]] = {}
        for feat in pre_data.get("features", {}).get("lng_lat", []):
            uid = feat.get("properties", {}).get("uid", "")
            if uid:
                lnglat_by_uid[uid] = parse_wkt_polygon(feat.get("wkt", ""))

        # metadata from pre and post
        pre_meta = pre_data.get("metadata", {})
        post_meta = post_data.get("metadata", {})
        gsd = pre_meta.get("gsd")

        # iterate over buildings (from pre labels — the canonical footprints)
        pre_feats = pre_data.get("features", {}).get("xy", [])
        for feat in pre_feats:
            props = feat.get("properties", {}) or {}
            if props.get("feature_type") != "building":
                continue

            uid = props.get("uid", "")
            if not uid:
                continue

            wkt_px = feat.get("wkt", "")
            rings_px = parse_wkt_polygon(wkt_px)
            if not rings_px or len(rings_px[0]) < 3:
                continue

            # damage label from post
            post_feat = post_by_uid.get(uid, {})
            post_props = post_feat.get("properties", {}) or {}
            damage_label = post_props.get("subtype", "un-classified")

            # geographic polygon
            rings_lnglat = lnglat_by_uid.get(uid, [])

            # centroid in lng/lat
            if rings_lnglat:
                centroid_lnglat = polygon_centroid(rings_lnglat)
                lng, lat = centroid_lnglat
            else:
                lng, lat = None, None

            # area
            area_px2 = shoelace_area(rings_px[0])
            area_m2 = area_px2 * (gsd ** 2) if gsd else None

            # bounding box
            bbox = polygon_bbox(rings_px)

            # short uid for filename
            uid_short = uid.split("-")[0] if "-" in uid else uid[:8]
            fname_base = f"{sid}_{uid_short}"

            # crop and save
            crop_filenames: Dict[str, str] = {}
            ext = "png"
            for phase in phases_to_crop:
                # use pre polygon coords for both pre and post crops (same building footprint)
                # for post, use post polygon if available (accounts for slight geo-registration shift)
                if phase == "post" and uid in post_by_uid:
                    post_wkt = post_by_uid[uid].get("wkt", "")
                    phase_rings = parse_wkt_polygon(post_wkt)
                    if not phase_rings or len(phase_rings[0]) < 3:
                        phase_rings = rings_px
                else:
                    phase_rings = rings_px

                crop_img = crop_building(
                    loaded_images[phase], phase_rings, args.padding, args.masked
                )
                crop_fname = f"{fname_base}_{phase}.{ext}"
                crop_path = os.path.join(out_dir, crop_fname)
                crop_img.save(crop_path)
                crop_filenames[phase] = crop_fname

            # manifest entry
            building_entry: Dict[str, Any] = {
                "uid": uid,
                "disaster": pre_meta.get("disaster", ""),
                "disaster_type": pre_meta.get("disaster_type", ""),
                "scene_id": sid,
                "damage_label": damage_label,
                "lat": lat,
                "lng": lng,
                "polygon_px": [[round(x, 2), round(y, 2)] for x, y in rings_px[0]],
                "polygon_lnglat": (
                    [[round(x, 6), round(y, 6)] for x, y in rings_lnglat[0]]
                    if rings_lnglat else None
                ),
                "bbox_px": [round(v, 2) for v in bbox],
                "area_px2": round(area_px2, 2),
                "area_m2": round(area_m2, 2) if area_m2 is not None else None,
                "gsd": gsd,
                "sensor": pre_meta.get("sensor"),
                "capture_date_pre": pre_meta.get("capture_date"),
                "capture_date_post": post_meta.get("capture_date"),
                "masked": args.masked,
            }

            for phase in phases_to_crop:
                building_entry[f"crop_{phase}"] = crop_filenames.get(phase)

            manifest.append(building_entry)
            total_buildings += 1

        # close images
        for img in loaded_images.values():
            img.close()

    # ---- write manifest ----
    manifest_path = os.path.join(out_dir, "buildings.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"[DONE] Cropped {total_buildings} buildings from {len(scene_ids)} scenes -> {out_dir}")
    if missing:
        print(f"       ({missing} warnings)")
    print(f"       Manifest: {manifest_path}")
    print(f"       Masked: {args.masked}")


if __name__ == "__main__":
    main()
