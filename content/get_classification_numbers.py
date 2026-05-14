import os
import json
from collections import Counter

def analyze_damage_jsons(folder_path):
    """
    Parses a directory of JSON files containing structural damage assessments.
    Returns a dictionary with counts of unique buildings per damage category.
    """
    results = {}
    
    # Standardize the categories we want to track
    categories = ['no-damage', 'minor-damage', 'major-damage', 'destroyed', 'unclassified']

    # Iterate through all files in the target folder
    for filename in os.listdir(folder_path):
        if not filename.endswith('.json'):
            continue
            
        filepath = os.path.join(folder_path, filename)
        
        try:
            with open(filepath, 'r') as file:
                data = json.load(file)
        except json.JSONDecodeError:
            print(f"Error decoding {filename}. Skipping.")
            continue

        # Dictionary to track unique buildings by their UID to prevent double-counting
        unique_buildings = {}
        
        features = data.get('features', {})
        
        # Check both arrays in case a building is missing from one
        for feature_group in ['lng_lat', 'xy']:
            for item in features.get(feature_group, []):
                properties = item.get('properties', {})
                uid = properties.get('uid')
                
                if uid:
                    # Default to 'unclassified' if subtype is missing
                    subtype = properties.get('subtype', 'unclassified')
                    unique_buildings[uid] = subtype
        
        # Tally the subtypes for the unique buildings in this specific file
        counts = Counter(unique_buildings.values())
        
        # Save the structured results
        results[filename] = {
            'no-damage': counts.get('no-damage', 0),
            'minor-damage': counts.get('minor-damage', 0),
            'major-damage': counts.get('major-damage', 0),
            'destroyed': counts.get('destroyed', 0),
            'unclassified': counts.get('unclassified', 0),
            'total': len(unique_buildings)
        }

    return results

def generate_markdown_table(results):
    """Prints the aggregated results as a Markdown table."""
    
    print("| Filename | No Damage | Minor Damage | Major Damage | Destroyed | Unclassified | Total Buildings |")
    print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    
    for filename, counts in sorted(results.items()):
        print(f"| **{filename}** | {counts['no-damage']} | {counts['minor-damage']} | "
              f"{counts['major-damage']} | {counts['destroyed']} | {counts['unclassified']} | "
              f"**{counts['total']}** |")
    
    print(f"\n**Total Unique Buildings Across All Files: {sum(counts['total'] for counts in results.values())}**")

if __name__ == "__main__":
    # ---> Set your target folder path here <---
    TARGET_FOLDER = r'C:\Users\keval\Documents\Aerial-Damage-Analysis-VLM\content\full-joplin-images-and-labels\labels'  # Update this path to your labels directory
    
    if os.path.exists(TARGET_FOLDER):
        parsed_data = analyze_damage_jsons(TARGET_FOLDER)
        if parsed_data:
            generate_markdown_table(parsed_data)
        else:
            print("No valid JSON files found in the directory.")
    else:
        print(f"The folder '{TARGET_FOLDER}' does not exist.")