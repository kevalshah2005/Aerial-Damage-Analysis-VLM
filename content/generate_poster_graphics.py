import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt

# --- 1. THE DATA (From your terminal output) ---
CLASSES = ["No Damage", "Minor Damage", "Major Damage", "Destroyed"]

# Confusion Matrix Data
# Rows = Actual, Columns = Predicted
CM_DATA = np.array([
    [8, 0, 0, 0],
    [3, 4, 1, 0],
    [3, 0, 12, 0],
    [1, 0, 4, 9]
])

# F1 Scores (Percentages)
QWEN_F1 = [69.57, 66.67, 75.00, 78.26]

# TODO: Replace these with your actual baseline model's F1 scores!
BASELINE_F1 = [45.00, 35.50, 55.20, 60.10] 


# --- 2. GENERATE CONFUSION MATRIX ---
def plot_confusion_matrix():
    plt.figure(figsize=(10, 8))
    
    # annot_kws controls the size of the numbers INSIDE the matrix boxes
    sns.heatmap(CM_DATA, annot=True, fmt='d', cmap='Blues', 
                xticklabels=CLASSES, 
                yticklabels=CLASSES,
                cbar=False,
                annot_kws={"size": 28, "weight": "bold"})
    
    # Increase the font size of the category names on the X and Y axis
    plt.xticks(fontsize=16, weight='bold')
    plt.yticks(fontsize=16, weight='bold', rotation=0)
    
    # Increase the font size of the Axis Labels
    plt.xlabel('Predicted Label', fontweight='bold', fontsize=22, labelpad=15)
    plt.ylabel('True Label', fontweight='bold', fontsize=22, labelpad=15)
    
    # Title
    plt.title('VLM Damage Classification\n(qwen3-vl-235b)', fontsize=26, fontweight='bold', pad=20)
    
    filename = 'poster_confusion_matrix.png'
    plt.savefig(filename, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"🖼️ Saved high-visibility confusion matrix to {filename}")


# --- 3. GENERATE F1 COMPARISON BAR CHART ---
def plot_f1_comparison():
    x = np.arange(len(CLASSES))  # the label locations
    width = 0.35  # the width of the bars

    fig, ax = plt.subplots(figsize=(10, 6))
    
    # Create the grouped bars
    rects1 = ax.bar(x - width/2, BASELINE_F1, width, label='xView2 CNN Baseline', color='lightgray')
    rects2 = ax.bar(x + width/2, QWEN_F1, width, label='DisasterLens (Qwen-VL)', color='#1f77b4')

    # Add some text for labels, title and custom x-axis tick labels, etc.
    ax.set_ylabel('F1 Score (%)', fontweight='bold', fontsize=18)
    ax.set_title('Baseline vs. DisasterLens: F1 Scores by Class', fontsize=22, fontweight='bold', pad=20)
    ax.set_xticks(x)
    ax.set_xticklabels(CLASSES, fontsize=14, fontweight='bold')
    ax.tick_params(axis='y', labelsize=14)
    
    # Format the legend
    ax.legend(fontsize=14, loc='upper left')

    # Attach a text label above each bar, displaying its height
    def autolabel(rects):
        for rect in rects:
            height = rect.get_height()
            ax.annotate(f'{height:.1f}%',
                        xy=(rect.get_x() + rect.get_width() / 2, height),
                        xytext=(0, 3),  # 3 points vertical offset
                        textcoords="offset points",
                        ha='center', va='bottom', fontsize=12, fontweight='bold')

    autolabel(rects1)
    autolabel(rects2)

    # Set the y-axis limit slightly higher to make room for the labels
    ax.set_ylim(0, max(max(QWEN_F1), max(BASELINE_F1)) + 15)

    filename = 'poster_f1_comparison.png'
    plt.savefig(filename, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"📊 Saved F1 comparison bar chart to {filename}")

if __name__ == "__main__":
    plot_confusion_matrix()
    plot_f1_comparison()