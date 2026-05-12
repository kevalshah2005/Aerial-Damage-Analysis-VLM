import os
import json
import time
import boto3
from botocore.exceptions import ClientError

# =================================================
# CONFIGURATION
# =================================================
# Set to False when you are ready to process the entire dataset overnight
TRIAL_RUN = True  

MODEL_ID = "qwen.qwen3-vl-235b-a22b"
IMAGE_DIR = "./full_joplin_cropped_buildings"
MANIFEST_PATH = "./full_joplin_cropped_buildings/buildings.json"
OUTPUT_DIR = "./generated_labels"

# Map VLM output to the required JSON standard labels
LABEL_MAPPING = {
    "No Damage": "no-damage",
    "Minor Damage": "minor-damage",
    "Major Damage": "major-damage",
    "Destroyed": "destroyed"
}

# Initialize the Bedrock client
client = boto3.client("bedrock-runtime", region_name="us-east-1")

# =================================================
# HELPER FUNCTIONS
# =================================================
def get_format(file_path):
    """Determines the image format required by Bedrock."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.png': return "png"
    if ext == '.webp': return "webp"
    if ext == '.gif': return "gif"
    return "jpeg"

def convert_to_wkt(polygon_lnglat):
    """Converts a list of [lng, lat] coordinate pairs into a WKT Polygon string."""
    coord_strings = [f"{coord[0]} {coord[1]}" for coord in polygon_lnglat]
    # WKT Polygons must be closed (first and last coordinate match)
    if coord_strings[0] != coord_strings[-1]:
        coord_strings.append(coord_strings[0])
    return f"POLYGON (({', '.join(coord_strings)}))"

def evaluate_building(pre_path, post_path, retries=3):
    """Sends the crop pair to the VLM and returns the predicted damage label."""
    with open(pre_path, "rb") as f:
        image_a_bytes = f.read()
    with open(post_path, "rb") as f:
        image_b_bytes = f.read()

    user_prompt = """You are an expert disaster response analyst comparing two aerial images: Image A (before) and Image B (after).

    Your task is to classify damage based on the structural mass surviving in Image B:
    - No Damage: The building matches Image A. The roof is smooth and solid. Forgive slight global color shifts (e.g. brown to gray) or blur.
    - Minor Damage: The building is standing. You see obvious bright BLUE TARPS or distinct high-contrast white patches.
    - Major Damage: Massive failure. A large chunk of the building mass is visibly missing or caved-in.
    - Destroyed: Total loss. You see a flat light-gray concrete slab, bare dirt, or a chaotic smudge of rubble.

    CRITICAL RULES:
    1. FORGIVE SENSOR NOISE: These crops are low-res. Do not call it damage if the edges are slightly blurry or the color is slightly different. Smooth = No Damage.
    2. THE MAss ANCHOR: If B shows a solid rectangle of a similar size to A, the building is STANDING.
    3. THE MAJOR TRIGGER: Major Damage requires a visible 'dark break' or missing section of the footprint.

    Respond strictly in this JSON format:
    {
      "visual_analysis": "[Is the rectangle smooth and solid (No Damage), tarped (Minor), broken (Major), or gone (Destroyed)?]",
      "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
      "confidence_score": "[0-100%]"
    }"""

    messages = [
        {
            "role": "user",
            "content": [
                {"text": "Image A (Pre-disaster):"},
                {"image": {"format": get_format(pre_path), "source": {"bytes": image_a_bytes}}},
                {"text": "Image B (Post-disaster):"},
                {"image": {"format": get_format(post_path), "source": {"bytes": image_b_bytes}}},
                {"text": user_prompt},
            ],
        }
    ]

    for attempt in range(1, retries + 1):
        try:
            response = client.converse(
                modelId=MODEL_ID,
                messages=messages,
                inferenceConfig={"maxTokens": 3000, "temperature": 0}
            )
            raw_text = response['output']['message']['content'][0]['text'].strip()
            
            # Clean up markdown code blocks if the model outputs them
            if raw_text.startswith("```"): 
                raw_text = raw_text.split("\n", 1)[-1]
            if raw_text.endswith("```"): 
                raw_text = raw_text.rsplit("\n", 1)[0]
            
            cleaned = raw_text.replace("```json", "").replace("```", "").strip()
            analysis = json.loads(cleaned)
            
            raw_label = analysis.get("damage_label", "No Damage")
            return LABEL_MAPPING.get(raw_label, "un-classified")

        except ClientError as error:
            if error.response['Error']['Code'] == 'ThrottlingException' and attempt < retries:
                time.sleep(2 ** attempt)
            else:
                print(f"\n[Error] Bedrock API ClientError: {error}")
                return "un-classified"
        except json.JSONDecodeError:
            print(f"\n[Error] Failed to parse JSON from model output: {raw_text}")
            return "un-classified"
        except Exception as e:
            print(f"\n[Error] Unexpected exception: {e}")
            return "un-classified"

# =================================================
# MAIN EXECUTION
# =================================================
def generate_scene_files():
    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Load the manifest
    if not os.path.exists(MANIFEST_PATH):
        print(f"Error: Could not find {MANIFEST_PATH}")
        return

    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        buildings = json.load(f)

    # Group buildings by scene_id
    scenes = {}
    for b in buildings:
        scene_id = b.get("scene_id")
        if not scene_id: 
            continue
        if scene_id not in scenes:
            scenes[scene_id] = []
        scenes[scene_id].append(b)

    # If Trial Run, limit to 1 scene and a max of 10 buildings
    scene_keys = list(scenes.keys())
    if TRIAL_RUN:
        print("\n⚠️ RUNNING IN TRIAL MODE (2 Scenes, max 5 buildings) ⚠️\n")
        scene_keys = scene_keys[:2]

    for scene_id in scene_keys:
        print(f"========================================")
        print(f"🎬 Processing Scene: {scene_id}")
        print(f"========================================")
        
        buildings_in_scene = scenes[scene_id]
        if TRIAL_RUN:
            buildings_in_scene = buildings_in_scene[:5]

        pre_features = []
        post_features = []

        for i, b in enumerate(buildings_in_scene):
            uid = b["uid"]
            
            # The buildings.json might have "crop_pre" and "crop_post" or you might need to construct it
            # If your building.json doesn't have crop_pre, adjust this logic to match how crop_buildings.py names them.
            crop_pre_filename = b.get("crop_pre", f"{uid}_pre.png")
            crop_post_filename = b.get("crop_post", f"{uid}_post.png")
            
            pre_path = os.path.join(IMAGE_DIR, crop_pre_filename)
            post_path = os.path.join(IMAGE_DIR, crop_post_filename)
            
            wkt_polygon = convert_to_wkt(b["polygon_lnglat"])

            # ---------------------------------------------------------
            # 1. Build the PRE disaster feature (No subtype required)
            # ---------------------------------------------------------
            pre_features.append({
                "properties": {
                    "feature_type": "building",
                    "uid": uid
                },
                "wkt": wkt_polygon
            })

            # ---------------------------------------------------------
            # 2. Evaluate the building for POST disaster subtype
            # ---------------------------------------------------------
            predicted_label = "un-classified"
            if os.path.exists(pre_path) and os.path.exists(post_path):
                print(f"  [{i+1}/{len(buildings_in_scene)}] Evaluating {uid[:8]}...", end="", flush=True)
                predicted_label = evaluate_building(pre_path, post_path)
                print(f" ({predicted_label})")
                time.sleep(0.5) # Slight rate-limit buffer to prevent throttling
            else:
                print(f"  [{i+1}/{len(buildings_in_scene)}] ⚠️ Missing crop files for {uid[:8]}. Defaulting to un-classified.")

            # ---------------------------------------------------------
            # 3. Build the POST disaster feature (Requires subtype)
            # ---------------------------------------------------------
            post_features.append({
                "properties": {
                    "feature_type": "building",
                    "subtype": predicted_label,
                    "uid": uid
                },
                "wkt": wkt_polygon
            })

        # Construct final JSON structures matching xBD schema perfectly
        pre_json = {"features": {"lng_lat": pre_features}}
        post_json = {"features": {"lng_lat": post_features}}

        # Save to disk
        pre_out_path = os.path.join(OUTPUT_DIR, f"{scene_id}_pre_disaster.json")
        post_out_path = os.path.join(OUTPUT_DIR, f"{scene_id}_post_disaster.json")

        # Use standard indenting or compact spacing depending on your preference. 
        # Using separators=(",", ": ") creates the compact, single-line look of the original xBD files.
        with open(pre_out_path, "w", encoding="utf-8") as f:
            json.dump(pre_json, f, separators=(",", ": "))
            
        with open(post_out_path, "w", encoding="utf-8") as f:
            json.dump(post_json, f, separators=(",", ": "))

        print(f"\n✅ Saved: {pre_out_path}")
        print(f"✅ Saved: {post_out_path}\n")

    print("🎉 Processing complete!")

if __name__ == "__main__":
    generate_scene_files()