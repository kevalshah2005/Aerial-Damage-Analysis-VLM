import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import fs from "fs";
import path from "path";

const client = new BedrockRuntimeClient({ region: "us-east-1" });

const IMAGE_DIR = process.argv[2];
const OUTPUT_FILE = process.argv[3] || "benchmark_results.json";

const MODELS = [
    // "amazon.nova-pro-v1:0",
    // "google.gemma-3-12b-it",
    "qwen.qwen3-vl-235b-a22b"
];

const GROUND_TRUTH_MAPPING = {
    "no-damage": "No Damage",
    "minor-damage": "Minor Damage",
    "major-damage": "Major Damage",
    "destroyed": "Destroyed"
};

function getFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return "png";
    if (ext === '.webp') return "webp";
    if (ext === '.gif') return "gif";
    return "jpeg";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function analysePairWithRetry(modelId, preA, postB, retries = 3) {
    const imageABytes = fs.readFileSync(preA);
    const imageBBytes = fs.readFileSync(postB);

    const userPrompt = `You are an expert disaster response analyst comparing two aerial, top-down images of the same building: Image A (before) and Image B (after).

    Your task is to determine the damage severity based STRICTLY on the official classification scale below.

    Official Classification Scale:
    - No damage: Undisturbed. No sign of water, structural damage, shingle damage, or burn marks.
    - Minor damage: Building partially burnt, water surrounding the structure, volcanic flow nearby, roof elements missing, or visible cracks.
    - Major damage: Partial wall or roof collapse, encroaching volcanic flow, or the structure is surrounded by water or mud.
    - Destroyed: Structure is scorched, completely collapsed, partially or completely covered with water or mud, or no longer present.

    CRITICAL TRANSLATION FOR PADDED AERIAL FLOOD IMAGERY:
    The official scale can be confusing for top-down images that include surrounding neighborhood context (padding). You MUST apply this translation key:

    1. "No sign of water" (No Damage): This applies ONLY to the building's specific footprint. Because these images have padding, you WILL see floodwater in the background, streets, or neighboring yards. YOU MUST IGNORE BACKGROUND WATER. If the specific house and its immediate footprint match Image A, select No Damage, but be careful to ensure the water is not in the building's footprint. Do not penalize the house for water in the padded background.
    2. "Water surrounding" (Minor) vs "Surrounded by water" (Major): This is a distinction of DEPTH. 
    - Minor Damage = Shallow water. Water has breached the immediate yard and is touching the house, but ground features (fences, grass, driveways) around it are still visible.
    - Major Damage = Deep water. The water is a thick, dark mass that completely hides the ground and the base of the house, making the house look like an island in a lake. OR the roof is visibly caved in.
    3. Destroyed: The roof is completely gone, the building is washed away, or entirely submerged under water.

    Respond strictly in this JSON format and nothing else:
    {
    "roof_and_structure_status": "[Compare the building in B to A. Is the geometry strictly identical?]",
    "floodwater_translation": "[Is water just in the background/street, shallow in the yard touching the house, or deep/submerging the ground?]",
    "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
    "confidence_score": "[Provide a percentage from 0% to 100%]"
    }`;


    const messages = [
        {
            role: "user",
            content: [
                { text: "Image A (Pre-disaster):" },
                { image: { format: getFormat(preA), source: { bytes: imageABytes } } },
                { text: "Image B (Post-disaster):" },
                { image: { format: getFormat(postB), source: { bytes: imageBBytes } } },
                { text: userPrompt },
            ],
        },
    ];

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const command = new ConverseCommand({
                modelId: modelId,
                messages,
                inferenceConfig: {
                    maxTokens: 3000,
                    temperature: 0,
                },
            });

            const response = await client.send(command);
            const rawText = response.output.message.content[0].text.trim();

            const cleaned = rawText
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, "")
                .trim();

            return JSON.parse(cleaned);
        } catch (error) {
            if (error.name === 'ThrottlingException' && attempt < retries) {
                const backoff = Math.pow(2, attempt) * 1000;
                console.warn(`\n[WARN] Throttled by ${modelId}. Retrying in ${backoff / 1000}s...`);
                await sleep(backoff);
            } else {
                throw error;
            }
        }
    }
}

function calculateMetrics(predictions, actuals) {
    const classes = Object.values(GROUND_TRUTH_MAPPING);

    // Confusion Matrix: actual -> predicted -> count
    const confusionMatrix = {};
    for (const c of classes) {
        confusionMatrix[c] = {};
        for (const p of classes) {
            confusionMatrix[c][p] = 0;
        }
    }

    let correct = 0;
    for (let i = 0; i < predictions.length; i++) {
        const p = predictions[i];
        const a = actuals[i];

        if (confusionMatrix[a] && confusionMatrix[a][p] !== undefined) {
            confusionMatrix[a][p]++;
        }

        if (p === a) {
            correct++;
        }
    }

    const accuracy = (correct / predictions.length) * 100;

    const classMetrics = {};
    for (const c of classes) {
        let truePositives = confusionMatrix[c][c];

        let falsePositives = 0;
        for (const a of classes) {
            if (a !== c) falsePositives += confusionMatrix[a][c];
        }

        let falseNegatives = 0;
        for (const p of classes) {
            if (p !== c) falseNegatives += confusionMatrix[c][p];
        }

        const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
        const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
        const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

        classMetrics[c] = {
            precision: (precision * 100).toFixed(2) + "%",
            recall: (recall * 100).toFixed(2) + "%",
            f1: (f1 * 100).toFixed(2) + "%"
        };
    }

    return { accuracy: accuracy.toFixed(2) + "%", classMetrics, confusionMatrix };
}

async function runBenchmark() {
    if (!IMAGE_DIR) {
        console.error("Usage: node benchmark_vlms.mjs <image_dir> [output.json]");
        process.exit(1);
    }

    const manifestPath = path.join(IMAGE_DIR, "buildings.json");
    if (!fs.existsSync(manifestPath)) {
        console.error(`Manifest not found: ${manifestPath}`);
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Filter valid buildings
    const validBuildings = manifest.filter(b => {
        return b.damage_label !== "un-classified" &&
            b.crop_pre && b.crop_post &&
            fs.existsSync(path.join(IMAGE_DIR, b.crop_pre)) &&
            fs.existsSync(path.join(IMAGE_DIR, b.crop_post));
    });

    if (validBuildings.length === 0) {
        console.error("No valid building pairs found for benchmarking.");
        process.exit(1);
    }

    console.log(`\nFound ${validBuildings.length} valid building pair(s). Starting benchmark across ${MODELS.length} models...\n`);

    const benchmarkResults = {};
    const metricsReport = {};

    for (const modelId of MODELS) {
        console.log(`\n==================================================`);
        console.log(`Benchmarking Model: ${modelId}`);
        console.log(`==================================================`);

        const results = [];
        const predictions = [];
        const actuals = [];

        for (let i = 0; i < validBuildings.length; i++) {
            const b = validBuildings[i];
            const preA = path.join(IMAGE_DIR, b.crop_pre);
            const postB = path.join(IMAGE_DIR, b.crop_post);
            const actualLabel = GROUND_TRUTH_MAPPING[b.damage_label];

            process.stdout.write(`[${i + 1}/${validBuildings.length}] ${b.uid.substring(0, 8)} (Actual: ${actualLabel}) ... `);

            try {
                const analysis = await analysePairWithRetry(modelId, preA, postB);

                let predictedLabel = analysis.damage_label;

                // Normalise capitalization if model didn't perfectly follow prompt
                if (predictedLabel.toLowerCase() === "no damage") predictedLabel = "No Damage";
                if (predictedLabel.toLowerCase() === "minor damage") predictedLabel = "Minor Damage";
                if (predictedLabel.toLowerCase() === "major damage") predictedLabel = "Major Damage";
                if (predictedLabel.toLowerCase() === "destroyed") predictedLabel = "Destroyed";

                predictions.push(predictedLabel);
                actuals.push(actualLabel);

                results.push({
                    uid: b.uid,
                    status: "success",
                    actual_label: actualLabel,
                    roof_and_structure_status: analysis.roof_and_structure_status,
                    floodwater_translation: analysis.floodwater_translation,
                    predicted_label: predictedLabel,
                    confidence_score: analysis.confidence_score,
                });

                const isCorrect = predictedLabel === actualLabel;
                const marker = isCorrect ? "✅" : "❌";
                console.log(`${marker} Predicted: ${predictedLabel} (${analysis.confidence_score})`);

            } catch (err) {
                results.push({
                    uid: b.uid,
                    status: "error",
                    actual_label: actualLabel,
                    error: err.message || String(err)
                });
                console.log(`❌ FAIL  ${err.message}`);
            }

            // Rate limit protection
            if (i < validBuildings.length - 1) {
                await sleep(500); // 500ms delay between requests
            }
        }

        benchmarkResults[modelId] = results;

        if (predictions.length > 0) {
            metricsReport[modelId] = calculateMetrics(predictions, actuals);
        }
    }

    console.log("\n==================== BENCHMARK REPORT ====================");
    for (const [modelId, metrics] of Object.entries(metricsReport)) {
        console.log(`\nModel: ${modelId}`);
        console.log(`Accuracy: ${metrics.accuracy}`);
        console.table(metrics.classMetrics);
        console.log("Confusion Matrix (Row=Actual, Col=Predicted):");
        console.table(metrics.confusionMatrix);
    }

    const finalOutput = {
        metrics: metricsReport,
        details: benchmarkResults
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2));
    console.log(`\nDetailed benchmark results saved to: ${OUTPUT_FILE}`);
}

runBenchmark();
