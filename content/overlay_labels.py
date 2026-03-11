
"""
Author: Itay Kadosh 
Date: 02/04/2026

Purpose: This script was written for the purpose of visualizing the xView2 dataset provided in part of the CS 4485 project with Prof. Dinc Semih.
         Using PIL, we overlay the bounding boxes (labels) provided in the JSON over both the pre & post disaster images. The output will then be saved in a specified
         output directory as pngs, with similar naming convention to the original labels.


"""


import os
import json
import argparse
import random
from typing import List, Tuple, Dict, Any

from PIL import Image, ImageDraw


# color map: subtype -> (outline_rgba, fill_rgba)
SUBTYPE_STYLE = {
    "destroyed":     ((255,   0,   0, 255), (255,   0,   0,  80)), # red
    "major-damage":  ((255, 165,   0, 255), (255, 165,   0,  80)), # orange
    "minor-damage":  ((255, 255,   0, 255), (255, 255,   0,  80)), # yellow
    "no-damage":     ((  0, 255,   0, 255), (  0, 255,   0,  70)), # green
    "un-classified": ((  0, 200, 255, 255), (  0, 200, 255,  70)), # cyan
}


def subtype_to_style(subtype: str):
    if not subtype:
        subtype = "un-classified"
    return SUBTYPE_STYLE.get(subtype.lower(), ((255, 255, 255, 255), (255, 255, 255, 60)))


def _parse_ring_text(ring_text: str) -> List[Tuple[float, float]]:
    pts: List[Tuple[float, float]] = []
    for pair in ring_text.split(","):
        pair = pair.strip()
        if not pair:
            continue
        x_str, y_str = pair.split()[:2]
        pts.append((float(x_str), float(y_str)))
    return pts


def parse_wkt_polygon_or_multipolygon(wkt: str) -> List[List[Tuple[float, float]]]:
    """
    Supports:
      POLYGON ((x y, ...), (hole...), ...)
      MULTIPOLYGON (((x y, ...)), ((x y, ...)), ...)
    Returns a list of rings (outer rings and holes), each ring is list of (x,y)
    """
    wkt = (wkt or "").strip()
    if not wkt:
        return []

    W = wkt.upper()
    rings: List[List[Tuple[float, float]]] = []

    if W.startswith("POLYGON"):
        inner = wkt[wkt.find("((") + 2 : wkt.rfind("))")]
        ring_texts = inner.split("), (")
        for rt in ring_texts:
            rings.append(_parse_ring_text(rt))
        return rings

    if W.startswith("MULTIPOLYGON"):
        inner = wkt[wkt.find("(((") + 3 : wkt.rfind(")))")]
        polys = inner.split(")), ((")
        for poly in polys:
            ring_texts = poly.split("), (")
            for rt in ring_texts:
                rings.append(_parse_ring_text(rt))
        return rings

    # if the data ever contains other types, skip safely (this is after a brief survey of data, will be finalized after statistical analysis)
    return []


def draw_polygons_on_image(image_path: str, json_path: str, out_path: str, line_width: int = 2) -> None:
    with open(json_path, "r", encoding="utf-8") as f:
        data: Dict[str, Any] = json.load(f)

    # open image
    base = Image.open(image_path).convert("RGBA")

    # transparent overlay so fill alpha works
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    feats = data.get("features", {}).get("xy", [])
    for feat in feats:
        props = feat.get("properties", {}) or {}
        subtype = props.get("subtype", "un-classified")
        outline, fill = subtype_to_style(subtype)

        wkt = feat.get("wkt", "")
        rings = parse_wkt_polygon_or_multipolygon(wkt)
        if not rings:
            continue

        for ring in rings:
            if len(ring) < 3:
                continue

            # fill + outline
            draw.polygon(ring, fill=fill, outline=outline)

            # thicker outline
            if line_width > 1:
                draw.line(ring + [ring[0]], fill=outline, width=line_width)

    composed = Image.alpha_composite(base, overlay).convert("RGB")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    composed.save(out_path)
    print(f"[OK] {out_path}")


def main():
    ap = argparse.ArgumentParser(description="Overlay xView2 label polygons on images and save visualizations.")
    ap.add_argument("--root", required=True, help="Path to split folder containing images/ and labels/ (e.g. ~/Downloads/xview2_test/test)") # folder containing both labels and images
    ap.add_argument("--out", default="vis_labels", help="Output folder name (created inside root unless absolute path)") # specified output folder
    ap.add_argument("--line_width", type=int, default=2, help="Polygon outline thickness") # aesthetics
    ap.add_argument("--limit", type=int, default=0, help="If --sample is OFF: process first N label files (0 = all). ""If --sample is ON: sample N PAIRS (2N files).")
    ap.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    ap.add_argument("--sample", action="store_true", help="Randomly sample N contiguous PAIRS (uses --limit) instead of taking first N files.")

    args = ap.parse_args()

    root = os.path.expanduser(args.root)
    images_dir = os.path.join(root, "images")
    labels_dir = os.path.join(root, "labels")

    label_files = sorted([f for f in os.listdir(labels_dir) if f.endswith(".json")])

    out_dir = args.out
    if not os.path.isabs(out_dir):
        out_dir = os.path.join(root, out_dir)

    if not os.path.isdir(images_dir):
        raise FileNotFoundError(f"Missing images dir: {images_dir}")
    if not os.path.isdir(labels_dir):
        raise FileNotFoundError(f"Missing labels dir: {labels_dir}")

    num_pairs = len(label_files) // 2
    if num_pairs == 0:
        raise FileNotFoundError(f"No label pairs found in {labels_dir} (need at least 2 .json files).")

    if args.sample:
        if args.limit <= 0:
            raise ValueError("--sample requires --limit > 0 (number of pairs to sample).")

        rng = random.Random(args.seed)
        k = min(args.limit, num_pairs)

        sampled_pair_indices = rng.sample(range(num_pairs), k=k)

        # consider pairs of pre & post disaster files
        file_indices = []
        for pi in sampled_pair_indices:
            i = 2 * pi
            file_indices.extend([i, i + 1])

        # keep processing order stable
        file_indices.sort()

        label_files = [label_files[i] for i in file_indices]

    else:
        # take first N JSON files (0 = all)
        if args.limit and args.limit > 0:
            label_files = label_files[:args.limit]

    missing = 0
    for lf in label_files:
        json_path = os.path.join(labels_dir, lf)
        img_name = os.path.splitext(lf)[0] + ".png"
        image_path = os.path.join(images_dir, img_name)

        if not os.path.exists(image_path):
            print(f"[WARN] missing image for {lf}: {image_path}")
            missing += 1
            continue

        out_path = os.path.join(out_dir, os.path.splitext(img_name)[0] + "_vis.png")
        draw_polygons_on_image(image_path, json_path, out_path, line_width=args.line_width)

    if missing:
        print(f"[DONE] Completed with {missing} missing images.")
    else:
        print("[DONE] Completed.")


if __name__ == "__main__":
    main()
