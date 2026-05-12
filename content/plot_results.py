import json
import sys
import os
from sklearn.metrics import confusion_matrix
import seaborn as sns
import matplotlib.pyplot as plt

# The ordered classes for our matrix
CLASSES = ["No Damage", "Minor Damage", "Major Damage", "Destroyed"]

def generate_large_confusion_matrix(actuals, predictions, model_id):
    """Generates and saves a confusion matrix with highly visible text for posters."""
    cm = confusion_matrix(actuals, predictions, labels=CLASSES)
    
    # Increased figure size to give the text more room to breathe
    plt.figure(figsize=(10, 8))
    
    # annot_kws controls the size of the numbers INSIDE the matrix boxes
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                xticklabels=CLASSES, 
                yticklabels=CLASSES,
                cbar=False,
                annot_kws={"size": 28, "weight": "bold"}) # Drastically increased size
    
    # Increase the font size of the category names on the X and Y axis
    plt.xticks(fontsize=16, weight='bold')
    plt.yticks(fontsize=16, weight='bold', rotation=0) # rotation=0 keeps Y-axis text horizontal
    
    # Increase the font size of the Axis Labels
    plt.xlabel('Predicted Label', fontweight='bold', fontsize=22, labelpad=15)
    plt.ylabel('True Label', fontweight='bold', fontsize=22, labelpad=15)
    
    # Clean up model ID for the title and filename
    clean_model_id = model_id.split(":")[-1] if ":" in model_id else model_id.split("/")[-1]
    
    # Increase the font size of the Title
    plt.title(f'VLM Damage Classification\n({clean_model_id})', fontsize=26, fontweight='bold', pad=20)
    
    filename = f'confusion_matrix_{clean_model_id.replace(".", "_")}_large.png'
    plt.savefig(filename, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"🖼️ Saved high-visibility confusion matrix to {filename}")

def main():
    # Default to benchmark_results.json if no argument is provided
    results_file = sys.argv[1] if len(sys.argv) > 1 else "benchmark_results.json"
    
    if not os.path.exists(results_file):
        print(f"Error: Could not find {results_file}. Please ensure you ran the benchmark script first.")
        sys.exit(1)
        
    print(f"Loading data from {results_file}...")
    with open(results_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    details = data.get("details", {})
    
    if not details:
        print("Error: 'details' key not found in the JSON file.")
        sys.exit(1)
        
    for model_id, results in details.items():
        actuals = []
        predictions = []
        
        for item in results:
            if item.get("status") == "success":
                # Only plot labels that exist in our valid CLASSES
                pred = item.get("predicted_label")
                if pred in CLASSES:
                    actuals.append(item.get("actual_label"))
                    predictions.append(pred)
                    
        if actuals and predictions:
            generate_large_confusion_matrix(actuals, predictions, model_id)
        else:
            print(f"No valid successful predictions found for {model_id} to plot.")

if __name__ == "__main__":
    main()