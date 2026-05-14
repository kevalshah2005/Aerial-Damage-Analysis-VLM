# version of benchmark_vlms.py with python libraries that produce graphics
import sys
import os
import json
import time
import boto3
from botocore.exceptions import ClientError
from sklearn.metrics import classification_report, confusion_matrix
import seaborn as sns
import matplotlib.pyplot as plt

# Initialize Bedrock client
client = boto3.client("bedrock-runtime", region_name="us-east-1")

MODELS = [
    # "amazon.nova-pro-v1:0",
    # "google.gemma-3-12b-it",
    "qwen.qwen3-vl-235b-a22b"
]

GROUND_TRUTH_MAPPING = {
    "no-damage": "No Damage",
    "minor-damage": "Minor Damage",
    "major-damage": "Major Damage",
    "destroyed": "Destroyed"
}

# The ordered classes for our matrix and metrics
CLASSES = ["No Damage", "Minor Damage", "Major Damage", "Destroyed"]

def get_format(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.png': return "png"
    if ext == '.webp': return "webp"
    if ext == '.gif': return "gif"
    return "jpeg"

def analyze_pair_with_retry(model_id, pre_a, post_b, retries=3):
    with open(pre_a, "rb") as f:
        image_a_bytes = f.read()
    with open(post_b, "rb") as f:
        image_b_bytes = f.read()

    # very good destroyed, good no damage, terrible minor and major damage
    # user_prompt = """You are an expert disaster response analyst comparing two aerial, top-down tightly cropped images of the same building: Image A (before) and Image B (after).

    # Your task is to determine the damage severity based STRICTLY on the official classification scale below.

    # Official Classification Scale:
    # - No damage: Undisturbed. No sign of water, structural damage, shingle damage, or burn marks.
    # - Minor damage: Building partially burnt, water surrounding the structure, volcanic flow nearby, roof elements missing, or visible cracks.
    # - Major damage: Partial wall or roof collapse, encroaching volcanic flow, or the structure is surrounded by water or mud.
    # - Destroyed: Structure is scorched, completely collapsed, partially or completely covered with water or mud, or no longer present.

    # CRITICAL TRANSLATION FOR TIGHT CROP TORNADO IMAGERY:
    # Lighting, colors, and resolution will change between Image A and B. DO NOT use color matching to determine damage. You MUST use this strict geometric logic:

    # 1. The "Trust the Rectangle" Rule (Standing Structure): A completely swept foundation slab is extremely rare. If you see a solid, light-colored or dark-colored rectangular footprint in Image B, it is almost certainly a STANDING ROOF. Look for a drop shadow or 3D volume on the edges to confirm it is off the ground. Do not classify a clean rectangle as a destroyed slab.
    # 2. No Damage (Clean Rectangle): The overall rectangular footprint is unbroken. The roof has no gaping holes, no tarps, and is not covered in debris.
    # 3. Minor Damage (Speckled/Tarped Rectangle): The rectangular footprint is standing, but the roof surface is damaged. Look for bright BLUE TARPS, or heavily speckled/missing shingles showing raw wood.
    # 4. Major Damage (Broken Rectangle / Cave-in): The geometric outline is broken. You can see a mix of intact roof AND a severe structural collapse. A massive section of the roof is visibly ripped open or caved in, exposing dark jagged interiors.
    # 5. Destroyed (Obliterated to Rubble): The rectangular footprint is completely gone. The entire crop is filled with an unrecognizable, chaotic pile of splintered debris and rubble. 

    # Respond strictly in this JSON format and nothing else:
    # {
    # "roof_and_structure_status": "[Does the building still have a solid rectangular footprint (standing), is the rectangle broken/caved-in (Major), or is it completely obliterated into scattered rubble (Destroyed)?]",
    # "structural_damage_analysis": "[Based on the footprint, classify as: Intact Rectangle (No Damage), Tarped/Speckled Rectangle (Minor), Broken/Caved-in Rectangle (Major), or Obliterated Rubble (Destroyed).]",
    # "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
    # "confidence_score": "[Provide a percentage from 0% to 100%]"
    # }"""

    # decent but not great at everything
    # user_prompt = """You are an expert disaster response analyst comparing two aerial, top-down tightly cropped images of the same building: Image A (before) and Image B (after).

    # Your task is to determine the damage severity based STRICTLY on the official classification scale below.

    # Official Classification Scale:
    # - No damage: Undisturbed. No sign of water, structural damage, shingle damage, or burn marks.
    # - Minor damage: Building partially burnt, water surrounding the structure, volcanic flow nearby, roof elements missing, or visible cracks.
    # - Major damage: Partial wall or roof collapse, encroaching volcanic flow, or the structure is surrounded by water or mud.
    # - Destroyed: Structure is scorched, completely collapsed, partially or completely covered with water or mud, or no longer present.

    # CRITICAL TORNADO RULES (SURVIVAL BIAS):
    # Tornado crops are messy. You MUST evaluate the damage by looking for SURVIVING structure to avoid over-predicting "Destroyed".

    # 1. The "Nothing Left" Rule (Destroyed): To select Destroyed, there must be ZERO standing structure. It must be 100% scattered splintered wood or a bare dirt/concrete pad. If you can identify ANY intact roof plane, standing wall, or organized structure, it is NOT Destroyed.
    # 2. Gaping Holes (Major Damage): You can see surviving structure, BUT there is a massive gaping hole punching through the roof into the dark interior, or a massive section of the walls is visibly crushed inward.
    # 3. Messy but Standing (Minor Damage): The building is generally standing and the roof is NOT caved in. However, the roof looks messy. Look for: missing shingles (speckled bare wood), bright BLUE TARPS, or branches/debris sitting ON TOP of an otherwise intact roof. A messy roof does NOT mean the house collapsed.
    # 4. Clean (No Damage): The roof looks clean, undisturbed, and matches the general geometry of Image A. 

    # Respond strictly in this JSON format and nothing else:
    # {
    # "visual_evidence": "[Look closely at Image B. Describe what you see in your own words. Can you see any surviving roof panels or standing walls? Are there gaping holes? Is there a tarp? Or is it 100% splintered wood/bare dirt?]",
    # "structural_damage_analysis": "[Based on your visual evidence, classify as: Clean (No Damage), Messy/Tarped (Minor), Gaping Hole/Partial Collapse (Major), or 100% Leveled (Destroyed).]",
    # "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
    # "confidence_score": "[Provide a percentage from 0% to 100%]"
    # }"""

    # good at no damage and destroyed, bad at minor, terrible at major
    # user_prompt = """You are an expert disaster response analyst comparing two aerial, top-down tightly cropped images of the same building: Image A (before) and Image B (after).

    # Your task is to determine the damage severity based STRICTLY on the official classification scale below.

    # Official Classification Scale:
    # - No damage: Undisturbed. No sign of water, structural damage, shingle damage, or burn marks.
    # - Minor damage: Building partially burnt, water surrounding the structure, volcanic flow nearby, roof elements missing, or visible cracks.
    # - Major damage: Partial wall or roof collapse, encroaching volcanic flow, or the structure is surrounded by water or mud.
    # - Destroyed: Structure is scorched, completely collapsed, partially or completely covered with water or mud, or no longer present.

    # CRITICAL TORNADO RULES (THE FOOTPRINT FRACTION):
    # Do not look for microscopic splinters or holes. Because these are tight crops, you must evaluate damage by estimating the PERCENTAGE of the original 2D footprint that survived.

    # 1. Destroyed (0% to 15% Surviving): The building is effectively gone. Only a bare slab, bare dirt, or a completely scattered pile of splinters remains. 
    # 2. Major Damage (20% to 90% Surviving): The building is partially standing, but a massive chunk of its 2D area is missing, crushed, or sheared off. It is a visually obvious mix of standing structure and destroyed area.
    # 3. Minor Damage (~100% Surviving, Messy Surface): The entire 2D shape of the house is standing (no missing wings or crushed halves). HOWEVER, the roof surface took a hit: look for distinct bright BLUE TARPS, or obvious speckled/missing shingles showing raw wood.
    # 4. No Damage (~100% Surviving, Clean Surface): The entire 2D shape is standing, AND the roof looks relatively undisturbed compared to Image A (ignore general dirt, tree shadows, and blurry pixels).

    # Respond strictly in this JSON format and nothing else:
    # {
    # "footprint_survival_fraction": "[Compare Image B to Image A. Estimate the percentage of the building's original 2D geometric shape that is still physically standing (e.g., 0%, 50%, 100%)]",
    # "surface_texture_check": "[If ~100% surviving, is the roof surface relatively clean, or is there a tarp / obvious bare wood?]",
    # "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
    # "confidence_score": "[Provide a percentage from 0% to 100%]"
    # }"""

    # pretty decent no damage, minor damage, destroyed, bad at major damage
    # user_prompt = """You are an expert disaster response analyst comparing two aerial, top-down tightly cropped images of the same building: Image A (before) and Image B (after).

    # Your task is to determine the damage severity based STRICTLY on the official classification scale below.

    # Official Classification Scale:
    # - No damage: Undisturbed. No sign of water, structural damage, shingle damage, or burn marks.
    # - Minor damage: Building partially burnt, water surrounding the structure, volcanic flow nearby, roof elements missing, or visible cracks.
    # - Major damage: Partial wall or roof collapse, encroaching volcanic flow, or the structure is surrounded by water or mud.
    # - Destroyed: Structure is scorched, completely collapsed, partially or completely covered with water or mud, or no longer present.

    # CRITICAL TORNADO RULES (MASS COMPARISON & OCCLUSION):
    # Do not look for "perfect" outlines. Aerial pixels are noisy. You MUST evaluate damage based on the overall structural mass compared to Image A, using these rules:

    # 1. Occlusion Forgiveness: Trees, debris, or dark shadows frequently overlap the edges of the roof in Image B. If a corner of the house is hidden by a tree or shadow, DO NOT assume the house is fractured or caved in.
    # 2. Destroyed (Mass Erased): The vast majority of the building's mass is completely gone. It is reduced to a disorganized smudge of debris or a bare dirt/concrete pad.
    # 3. Major Damage (Mass Caved-In): The building is standing, but a massive, visually obvious chunk of the core structural mass is missing or crushed inward. It looks like a giant bite was taken out of the roof structure itself (not just a shadow).
    # 4. Minor Damage (Mass Present + Surface Damage): The overall structural mass of the house is fully present (no massive cave-ins). HOWEVER, the roof surface is scarred. Look for distinct BLUE TARPS or widespread missing shingles showing raw wood.
    # 5. No Damage (Mass Present + Smooth): The overall structural mass is fully present, and the roof looks structurally undisturbed compared to Image A (ignoring overhanging trees, dirt, or shadows).

    # Respond strictly in this JSON format and nothing else:
    # {
    # "occlusion_and_mass_check": "[Compare B to A. Is the overall structural mass fully present, missing a massive caved-in chunk, or totally erased? Explicitly note if shadows/trees are just obscuring the edges.]",
    # "surface_check": "[If the mass is fully present, is the roof surface tarped/speckled (Minor) or undisturbed (No Damage)?]",
    # "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
    # "confidence_score": "[Provide a percentage from 0% to 100%]"
    # }"""

    # good at all
    # user_prompt = """You are an expert disaster response analyst comparing two aerial images: Image A (before) and Image B (after).

    # Your task is to classify damage based on the structural mass surviving in Image B:
    # - No Damage: The building matches Image A. The roof is smooth and solid. Forgive slight global color shifts (e.g. brown to gray) or blur.
    # - Minor Damage: The building is standing. You see obvious bright BLUE TARPS or distinct high-contrast white patches.
    # - Major Damage: Massive failure. A large chunk of the building mass is visibly missing or caved-in.
    # - Destroyed: Total loss. You see a flat light-gray concrete slab, bare dirt, or a chaotic smudge of rubble.

    # CRITICAL RULES:
    # 1. FORGIVE SENSOR NOISE: These crops are low-res. Do not call it damage if the edges are slightly blurry or the color is slightly different. Smooth = No Damage.
    # 2. THE MAss ANCHOR: If B shows a solid rectangle of a similar size to A, the building is STANDING.
    # 3. THE MAJOR TRIGGER: Major Damage requires a visible 'dark break' or missing section of the footprint.

    # Respond strictly in this JSON format:
    # {
    #   "visual_analysis": "[Is the rectangle smooth and solid (No Damage), tarped (Minor), broken (Major), or gone (Destroyed)?]",
    #   "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
    #   "confidence_score": "[0-100%]"
    # }"""

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
                {"image": {"format": get_format(pre_a), "source": {"bytes": image_a_bytes}}},
                {"text": "Image B (Post-disaster):"},
                {"image": {"format": get_format(post_b), "source": {"bytes": image_b_bytes}}},
                {"text": user_prompt},
            ],
        }
    ]

    for attempt in range(1, retries + 1):
        try:
            response = client.converse(
                modelId=model_id,
                messages=messages,
                inferenceConfig={
                    "maxTokens": 3000,
                    "temperature": 0,
                }
            )
            raw_text = response['output']['message']['content'][0]['text'].strip()

            # Clean up potential markdown blocks
            if raw_text.startswith("```"):
                raw_text = raw_text.split("\n", 1)[-1]
            if raw_text.endswith("```"):
                raw_text = raw_text.rsplit("\n", 1)[0]
            
            cleaned = raw_text.replace("```json", "").replace("```", "").strip()
            return json.loads(cleaned)

        except ClientError as error:
            if error.response['Error']['Code'] == 'ThrottlingException' and attempt < retries:
                backoff = (2 ** attempt)
                print(f"\n[WARN] Throttled by {model_id}. Retrying in {backoff}s...")
                time.sleep(backoff)
            else:
                raise error
        except json.JSONDecodeError as error:
             print(f"\n[ERROR] JSON Parsing failed for output: {raw_text}")
             raise error

def generate_confusion_matrix_plot(actuals, predictions, model_id):
    """Generates and saves a high-res confusion matrix graphic."""
    cm = confusion_matrix(actuals, predictions, labels=CLASSES)
    
    plt.figure(figsize=(8, 6))
    # cmap='Blues' is standard for academic papers/posters
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                xticklabels=CLASSES, 
                yticklabels=CLASSES,
                cbar=False,
                annot_kws={"size": 24, "weight": "bold"}) # Turned off colorbar for a cleaner look
    
    plt.xlabel('Predicted Label', fontweight='bold', labelpad=10)
    plt.ylabel('True Label', fontweight='bold', labelpad=10)
    
    # Clean up model ID for the title and filename
    clean_model_id = model_id.split(":")[-1] if ":" in model_id else model_id.split("/")[-1]
    
    plt.title(f'VLM Damage Classification\n({clean_model_id})', pad=15)
    
    filename = f'confusion_matrix_{clean_model_id.replace(".", "_")}.png'
    plt.savefig(filename, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"🖼️ Saved high-resolution confusion matrix to {filename}")

def run_benchmark():
    if len(sys.argv) < 2:
        print("Usage: python benchmark_vlms.py <image_dir> [output.json]")
        sys.exit(1)

    image_dir = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else "benchmark_results.json"

    manifest_path = os.path.join(image_dir, "buildings.json")
    if not os.path.exists(manifest_path):
        print(f"Manifest not found: {manifest_path}")
        sys.exit(1)

    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    # Filter valid buildings
    valid_buildings = []
    for b in manifest:
        if b.get("damage_label") != "un-classified" and b.get("crop_pre") and b.get("crop_post"):
            pre_path = os.path.join(image_dir, b["crop_pre"])
            post_path = os.path.join(image_dir, b["crop_post"])
            if os.path.exists(pre_path) and os.path.exists(post_path):
                valid_buildings.append(b)

    if not valid_buildings:
        print("No valid building pairs found for benchmarking.")
        sys.exit(1)

    print(f"\nFound {len(valid_buildings)} valid building pair(s). Starting benchmark across {len(MODELS)} models...\n")

    benchmark_results = {}
    metrics_report = {}

    for model_id in MODELS:
        print(f"\n==================================================")
        print(f"Benchmarking Model: {model_id}")
        print(f"==================================================")

        results = []
        predictions = []
        actuals = []

        for i, b in enumerate(valid_buildings):
            pre_a = os.path.join(image_dir, b["crop_pre"])
            post_b = os.path.join(image_dir, b["crop_post"])
            actual_label = GROUND_TRUTH_MAPPING[b["damage_label"]]

            uid_short = b["uid"][:8]
            sys.stdout.write(f"[{i + 1}/{len(valid_buildings)}] {uid_short} (Actual: {actual_label}) ... ")
            sys.stdout.flush()

            try:
                analysis = analyze_pair_with_retry(model_id, pre_a, post_b)
                
                predicted_label = analysis.get("damage_label", "")

                # Normalise capitalization
                pred_lower = predicted_label.lower()
                if "no damage" in pred_lower: predicted_label = "No Damage"
                elif "minor" in pred_lower: predicted_label = "Minor Damage"
                elif "major" in pred_lower: predicted_label = "Major Damage"
                elif "destroyed" in pred_lower: predicted_label = "Destroyed"

                # Only append if valid to avoid blowing up sklearn metrics
                if predicted_label in CLASSES:
                    predictions.append(predicted_label)
                    actuals.append(actual_label)

                # Dynamically construct the result payload
                result_payload = {
                    "uid": b["uid"],
                    "status": "success",
                    "actual_label": actual_label,
                    "predicted_label": predicted_label
                }
                
                # Merge whatever JSON keys the LLM generated directly into the payload
                result_payload.update(analysis)
                
                results.append(result_payload)

                is_correct = (predicted_label == actual_label)
                marker = "✅" if is_correct else "❌"
                print(f"{marker} Predicted: {predicted_label} ({analysis.get('confidence_score', 'N/A')})")

            except Exception as err:
                results.append({
                    "uid": b["uid"],
                    "status": "error",
                    "actual_label": actual_label,
                    "error": str(err)
                })
                print(f"❌ FAIL  {str(err)}")

            # Rate limit protection
            if i < len(valid_buildings) - 1:
                time.sleep(0.5)

        benchmark_results[model_id] = results

        if predictions:
            # Generate terminal report
            report_dict = classification_report(actuals, predictions, labels=CLASSES, output_dict=True, zero_division=0)
            metrics_report[model_id] = report_dict
            
            # Generate Graphic
            generate_confusion_matrix_plot(actuals, predictions, model_id)

    print("\n==================== BENCHMARK REPORT ====================")
    for model_id, metrics in metrics_report.items():
        print(f"\nModel: {model_id}")
        accuracy = metrics.get('accuracy', 0) * 100
        print(f"Overall Accuracy: {accuracy:.2f}%\n")
        
        # Format the terminal table
        print(f"{'Class':<15} | {'Precision':<9} | {'Recall':<9} | {'F1-Score':<9}")
        print("-" * 50)
        for cls in CLASSES:
            if cls in metrics:
                p = metrics[cls]['precision'] * 100
                r = metrics[cls]['recall'] * 100
                f = metrics[cls]['f1-score'] * 100
                print(f"{cls:<15} | {p:>8.2f}% | {r:>8.2f}% | {f:>8.2f}%")

    final_output = {
        "metrics": metrics_report,
        "details": benchmark_results
    }

    with open(output_file, "w", encoding='utf-8') as f:
        json.dump(final_output, f, indent=2)
    print(f"\nDetailed benchmark results saved to: {output_file}")

if __name__ == "__main__":
    run_benchmark()