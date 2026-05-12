import os
import shutil
import subprocess
import json

# ================= CONFIGURATION =================
# Define the list of paddings you want to test
PADDINGS_TO_TEST = [15, 25, 40, 50, 65, 80]

# Paths
ROOT_IMAGES_DIR = "./joplin-images-and-labels"
CROP_OUTPUT_DIR = "../joplin_cropped_buildings"
CROP_DIR = "./joplin_cropped_buildings"  # input to benchmark script
MASTER_REPORT_FILE = "padding_search_results.json"
# =================================================

def run_padding_search():
    overall_results = []

    for pad in PADDINGS_TO_TEST:
        print(f"\n{'='*60}")
        print(f"🚀 STARTING BENCHMARK FOR PADDING: {pad}px")
        print(f"{'='*60}")

        # Step 1: Delete the existing cropped folder to ensure a clean slate
        if os.path.exists(CROP_DIR):
            print(f"🗑️  Deleting old crop directory: {CROP_DIR}")
            shutil.rmtree(CROP_DIR)

        # Step 2: Run the cropping script
        print(f"✂️  Cropping images with {pad}px padding...")
        crop_cmd = [
            "python", "crop_buildings.py", 
            "--root", ROOT_IMAGES_DIR, 
            "--out", CROP_OUTPUT_DIR, 
            "--padding", str(pad)
        ]
        
        try:
            subprocess.run(crop_cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"❌ Cropping script failed for padding {pad}. Skipping...")
            continue

        # Step 3: Run the benchmark script
        # We pass a custom output JSON filename so we don't overwrite previous runs
        benchmark_json_out = f"benchmark_results_pad_{pad}.json"
        print(f"🤖 Running VLM Benchmark... (Saving traces to {benchmark_json_out})")
        
        benchmark_cmd = [
            "python", "benchmark_vlms.py", 
            CROP_DIR, 
            benchmark_json_out
        ]
        
        try:
            subprocess.run(benchmark_cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"❌ Benchmark script failed for padding {pad}. Skipping...")
            continue

        # Step 4: Parse the results to get the accuracy and metrics
        if os.path.exists(benchmark_json_out):
            with open(benchmark_json_out, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            # Assuming you are testing Qwen. Change the key if you switch to Gemma/Nova.
            model_key = "qwen.qwen3-vl-235b-a22b" 
            
            if "metrics" in data and model_key in data["metrics"]:
                metrics = data["metrics"][model_key]
                accuracy = metrics.get("accuracy", 0.0)
                
                print(f"🎯 Padding {pad}px achieved Accuracy: {accuracy * 100:.2f}%")
                
                overall_results.append({
                    "padding": pad,
                    "accuracy": accuracy,
                    "metrics": metrics,
                    "trace_file": benchmark_json_out
                })
            else:
                print(f"⚠️ Could not find metrics for {model_key} in {benchmark_json_out}")
        else:
            print(f"⚠️ Benchmark output file {benchmark_json_out} not found!")

    # Step 5: Rank the results and save the master report
    print(f"\n{'='*60}")
    print("🏆 FINAL PADDING RANKINGS (Ranked by Accuracy)")
    print(f"{'='*60}")
    
    # Sort descending by accuracy
    ranked_results = sorted(overall_results, key=lambda x: x["accuracy"], reverse=True)
    
    for i, res in enumerate(ranked_results):
        pad = res["padding"]
        acc = res["accuracy"] * 100
        print(f"{i+1}. Padding: {pad}px | Accuracy: {acc:.2f}% | (Traces: {res['trace_file']})")
        
    # Save the master ranking JSON
    with open(MASTER_REPORT_FILE, 'w', encoding='utf-8') as f:
        json.dump({"ranked_paddings": ranked_results}, f, indent=2)
        
    print(f"\n📁 Full ranking details saved to {MASTER_REPORT_FILE}")

if __name__ == "__main__":
    run_padding_search()