import os
import json
import statistics
from collections import Counter

def get_file_counts(folder_path, target_categories):
    """Parses JSONs and returns a dictionary of their building counts."""
    file_counts = {}
    
    print("Parsing files...")
    for filename in os.listdir(folder_path):
        if not filename.endswith('_post_disaster.json'):
            continue
            
        filepath = os.path.join(folder_path, filename)
        try:
            with open(filepath, 'r') as file:
                data = json.load(file)
        except json.JSONDecodeError:
            continue

        unique_buildings = {}
        features = data.get('features', {})
        
        # Extract unique buildings by uid
        for group in ['lng_lat', 'xy']:
            for item in features.get(group, []):
                props = item.get('properties', {})
                uid = props.get('uid')
                if uid:
                    unique_buildings[uid] = props.get('subtype', 'unclassified')
                    
        counts = Counter(unique_buildings.values())
        
        # Store counts strictly for our target categories
        file_counts[filename] = {cat: counts.get(cat, 0) for cat in target_categories}
        
    return file_counts

def greedy_file_selection(file_counts, target_categories, num_files_to_select):
    """
    Iteratively selects files to minimize the Coefficient of Variation 
    across the target damage categories.
    """
    selected_files = []
    current_totals = {cat: 0 for cat in target_categories}
    unselected_files = list(file_counts.keys())
    
    if num_files_to_select > len(unselected_files):
        num_files_to_select = len(unselected_files)

    print(f"\nRunning greedy optimization to select {num_files_to_select} files...")

    for step in range(num_files_to_select):
        best_file = None
        best_cv = float('inf')
        
        for filename in unselected_files:
            # Calculate what the totals would be if we added this file
            hypothetical_totals = [
                current_totals[cat] + file_counts[filename][cat] 
                for cat in target_categories
            ]
            
            mean_val = statistics.mean(hypothetical_totals)
            
            # Prevent division by zero if a file has absolutely no buildings
            if mean_val == 0:
                continue
                
            stdev_val = statistics.pstdev(hypothetical_totals)
            cv = stdev_val / mean_val  # Coefficient of Variation
            
            # We want the lowest possible variation
            if cv < best_cv:
                best_cv = cv
                best_file = filename
                
        if best_file:
            selected_files.append(best_file)
            unselected_files.remove(best_file)
            
            # Update our running totals
            for cat in target_categories:
                current_totals[cat] += file_counts[best_file][cat]
        else:
            print("Could not find any more files with valid data.")
            break

    return selected_files, current_totals

if __name__ == "__main__":
    # ---> CONFIGURATION <---
    TARGET_FOLDER = r'C:\Users\keval\Documents\Aerial-Damage-Analysis-VLM\content\joplin-images-and-labels\labels'
    NUM_FILES_TO_SELECT = 1
    
    # We generally exclude 'unclassified' from the optimization math so it 
    # doesn't skew the balancing of the actual damage states.
    TARGET_CATEGORIES = ['no-damage', 'minor-damage', 'major-damage', 'destroyed']
    
    if os.path.exists(TARGET_FOLDER):
        all_counts = get_file_counts(TARGET_FOLDER, TARGET_CATEGORIES)
        
        if all_counts:
            optimal_files, final_totals = greedy_file_selection(
                all_counts, 
                TARGET_CATEGORIES, 
                NUM_FILES_TO_SELECT
            )
            
            print("\n--- OPTIMIZATION COMPLETE ---")
            print("Selected Files:")
            for f in optimal_files:
                print(f" - {f}")
                
            print("\nFinal Aggregate Pool Counts:")
            for cat in TARGET_CATEGORIES:
                print(f" - {cat.title()}: {final_totals[cat]}")
        else:
            print("No valid data found in JSONs.")
    else:
        print(f"The folder '{TARGET_FOLDER}' does not exist.")