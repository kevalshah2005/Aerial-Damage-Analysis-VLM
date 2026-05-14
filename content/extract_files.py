import os
import shutil

def extract_files():
    # Define directories
    TARGET_FOLDER = r'C:\Users\keval\Downloads\Aerial-Damage-Analysis-VLM-28d1ca1a72421d026a1280ccd6c26b694978a7c8\Aerial-Damage-Analysis-VLM-28d1ca1a72421d026a1280ccd6c26b694978a7c8\content\images-and-labels'
    DESTINATION_FOLDER = './content/balanced-images-and-labels' 
    
    # Define the subfolders
    IMAGES_FOLDER = os.path.join(DESTINATION_FOLDER, 'images')
    LABELS_FOLDER = os.path.join(DESTINATION_FOLDER, 'labels')
    
    # The base list of post-disaster JSON files
    file_list = [
        "hurricane-harvey_00000485_post_disaster.json",
        "hurricane-harvey_00000516_post_disaster.json",
        "hurricane-harvey_00000498_post_disaster.json",
        "hurricane-harvey_00000504_post_disaster.json",
        "hurricane-harvey_00000227_post_disaster.json",
        "hurricane-harvey_00000036_post_disaster.json",
        "hurricane-harvey_00000103_post_disaster.json",
        "hurricane-harvey_00000259_post_disaster.json",
        "hurricane-harvey_00000093_post_disaster.json",
        "hurricane-harvey_00000164_post_disaster.json",
        "hurricane-harvey_00000166_post_disaster.json",
        "hurricane-harvey_00000186_post_disaster.json",
        "hurricane-harvey_00000246_post_disaster.json",
        "hurricane-harvey_00000254_post_disaster.json",
        "hurricane-harvey_00000294_post_disaster.json",
        "hurricane-harvey_00000314_post_disaster.json",
        "hurricane-harvey_00000324_post_disaster.json",
        "hurricane-harvey_00000428_post_disaster.json",
        "hurricane-harvey_00000298_post_disaster.json",
        "hurricane-harvey_00000037_post_disaster.json",
        "hurricane-harvey_00000044_post_disaster.json",
        "hurricane-harvey_00000058_post_disaster.json",
        "hurricane-harvey_00000063_post_disaster.json",
        "hurricane-harvey_00000283_post_disaster.json",
        "hurricane-harvey_00000303_post_disaster.json",
        "hurricane-harvey_00000182_post_disaster.json",
        "hurricane-harvey_00000326_post_disaster.json",
        "hurricane-harvey_00000341_post_disaster.json",
        "hurricane-harvey_00000342_post_disaster.json",
        "hurricane-harvey_00000161_post_disaster.json",
        "hurricane-harvey_00000097_post_disaster.json",
        "hurricane-harvey_00000211_post_disaster.json",
        "hurricane-harvey_00000185_post_disaster.json",
        "hurricane-harvey_00000328_post_disaster.json",
        "hurricane-harvey_00000062_post_disaster.json",
        "hurricane-harvey_00000064_post_disaster.json",
        "hurricane-harvey_00000305_post_disaster.json",
        "hurricane-harvey_00000308_post_disaster.json",
        "hurricane-harvey_00000068_post_disaster.json",
        "hurricane-harvey_00000276_post_disaster.json"
    ]

    # Create the destination subfolders if they don't already exist
    for folder in [IMAGES_FOLDER, LABELS_FOLDER]:
        if not os.path.exists(folder):
            os.makedirs(folder)
            print(f"Created directory: {folder}")

    files_copied = 0
    files_missing = 0

    for post_json_filename in file_list:
        # Determine the corresponding pre/post filenames
        post_png_filename = post_json_filename.replace('.json', '.png')
        pre_json_filename = post_json_filename.replace('_post_disaster.json', '_pre_disaster.json')
        pre_png_filename = post_json_filename.replace('_post_disaster.json', '_pre_disaster.png')
        
        # Map each filename to its intended destination subfolder
        files_to_copy = {
            post_json_filename: LABELS_FOLDER,
            post_png_filename: IMAGES_FOLDER,
            pre_json_filename: LABELS_FOLDER,
            pre_png_filename: IMAGES_FOLDER
        }

        # Process all 4 files for the current record
        for filename, dest_folder in files_to_copy.items():
            src_path = os.path.join(TARGET_FOLDER, filename)
            dest_path = os.path.join(dest_folder, filename)

            if os.path.exists(src_path):
                shutil.copy2(src_path, dest_path)
                files_copied += 1
            else:
                print(f"MISSING: {filename}")
                files_missing += 1

    print("-" * 30)
    print("Transfer Complete!")
    print(f"Successfully sorted and copied {files_copied} files.")
    if files_missing > 0:
        print(f"Could not find {files_missing} files. Check the console output above.")

if __name__ == "__main__":
    extract_files()