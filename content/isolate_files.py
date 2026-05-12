import os

def isolate_dataset_files():
    # 1. Your selected post-disaster JSONs
    selected_files = [
        "joplin-tornado_00000090_post_disaster.json",
        "joplin-tornado_00000024_post_disaster.json",
        "joplin-tornado_00000032_post_disaster.json",
        "joplin-tornado_00000070_post_disaster.json",
        "joplin-tornado_00000026_post_disaster.json",
    ]

    # 2. Extract the base scene names (e.g., "hurricane-harvey_00000485")
    # This ensures we keep BOTH pre and post disaster files for images and labels
    kept_prefixes = set(f.replace("_post_disaster.json", "") for f in selected_files)

    # ---> Set your target folders here <---
    directories_to_clean = [
        "./joplin-images-and-labels/images", 
        "./joplin-images-and-labels/labels"
    ]

    # Set to False ONLY when you are ready to permanently delete files
    DRY_RUN = False

    print(f"Targeting {len(kept_prefixes)} scenes to keep.")
    if DRY_RUN:
        print("Executing DRY RUN. No files will be permanently deleted.\n")

    for directory in directories_to_clean:
        if not os.path.exists(directory):
            print(f"Warning: Directory '{directory}' not found. Skipping.")
            continue

        deleted_count = 0
        kept_count = 0

        for filename in os.listdir(directory):
            filepath = os.path.join(directory, filename)
            
            # Skip subdirectories if any exist
            if os.path.isdir(filepath):
                continue

            # Check if the file starts with any of our kept scene prefixes
            keep_file = any(filename.startswith(prefix) for prefix in kept_prefixes)

            if keep_file:
                kept_count += 1
            else:
                if DRY_RUN:
                    print(f"[DRY RUN] Would delete: {filepath}")
                else:
                    os.remove(filepath)
                deleted_count += 1
                
        print(f"\n--- '{directory}' Summary ---")
        print(f"Files Kept: {kept_count}")
        print(f"Files {'Flagged for Deletion' if DRY_RUN else 'Deleted'}: {deleted_count}\n")

if __name__ == "__main__":
    isolate_dataset_files()