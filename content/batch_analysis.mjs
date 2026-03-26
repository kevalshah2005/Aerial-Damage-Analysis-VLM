import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import fs from "fs";
import path from "path";

const client = new BedrockRuntimeClient({ region: "us-east-1" });

const IMAGE_DIR   = process.argv[2];          
const OUTPUT_FILE = process.argv[3] || "results.json";


function pairImages(dir) {
    if (!fs.existsSync(dir)) {
        console.error(`Directory not found: ${dir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith(".png"))
        .sort();

    const groups = new Map();

    for (const filename of files) {
        const base = path.basename(filename, ".png");

        let tileId, type;

        if (base.includes("_pre_disaster")) {
        tileId = base.replace("_pre_disaster", "");
        type = "pre";
        } else if (base.includes("_post_disaster")) {
        tileId = base.replace("_post_disaster", "");
        type = "post";
        } else if (base.endsWith("_pre")) {
        tileId = base.replace("_pre", "");
        type = "pre";
        } else if (base.endsWith("_post")) {
        tileId = base.replace("_post", "");
        type = "post";
        } else {
            console.warn(`[SKIP] No _pre_disaster or _post_disaster in filename: ${filename}`);
            continue;
        }

        if (!groups.has(tileId)) groups.set(tileId, {});
        groups.get(tileId)[type] = path.join(dir, filename);
    }

    const pairs   = [];
    const orphans = [];

    for (const [tileId, entry] of groups.entries()) {
        if (entry.pre && entry.post) {
            pairs.push({ id: tileId, preA: entry.pre, postB: entry.post });
        } else {
            orphans.push(`${tileId} (missing: ${!entry.pre ? "pre" : "post"})`);
        }
    }

    if (orphans.length > 0) {
        console.warn(`\n[WARN] ${orphans.length} tile(s) could not be paired and were skipped:`);
        orphans.forEach(o => console.warn(`   - ${o}`));
    }

    return pairs;
}

async function analysePair(pair) {
    const imageABytes = fs.readFileSync(pair.preA);
    const imageBBytes = fs.readFileSync(pair.postB);

    const userPrompt = `You are an expert disaster response analyst. Analyze the provided pre-disaster (Image A) and post-disaster (Image B) images of the same building.
Assess the level of structural damage sustained using the following classification schema:
No Damage: The building appears undisturbed with no visible structural changes or debris.
Minor Damage: Superficial damage, minor roof damage (e.g., missing shingles), or small amounts of debris. The core structure remains intact.
Major Damage: Significant structural failure, partial building collapse, or substantial roof/wall loss.
Destroyed: Complete or near-complete collapse of the building; only the foundation or a rubble pile remains.
Based on your comparative visual analysis, provide your response strictly in the following JSON format and nothing else:
{
  "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
  "confidence_score": "[Provide a percentage from 0% to 100%]",
  "justification": "[Provide a brief, 1-2 sentence explanation detailing the specific visual evidence from Image B compared to Image A that supports your classification.]"
}`;

    const messages = [
        {
            role: "user",
            content: [
                { text: "Image A (Pre-disaster):" },
                { image: { format: "png", source: { bytes: imageABytes } } },
                { text: "Image B (Post-disaster):" },
                { image: { format: "png", source: { bytes: imageBBytes } } },
                { text: userPrompt },
            ],
        },
    ];

    const command = new ConverseCommand({
        modelId: "google.gemma-3-12b-it",
        messages,
        inferenceConfig: {
            maxTokens: 1000,
            temperature: 0,
        },
    });

    const response = await client.send(command);
    const rawText  = response.output.message.content[0].text.trim();

    const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

    return JSON.parse(cleaned);
}

async function runBatch() {
    if (!IMAGE_DIR) {
        console.error("Usage: node batch_analysis.mjs <image_dir> [output.json]");
        process.exit(1);
    }

    const pairs = pairImages(IMAGE_DIR);

    if (pairs.length === 0) {
        console.error("No matching image pairs found.");
        process.exit(1);
    }

    console.log(`\nFound ${pairs.length} image pair(s). Starting analysis...\n`);

    const results = [];

    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        process.stdout.write(`[${i + 1}/${pairs.length}] ${pair.id} ... `);

        try {
            const analysis = await analysePair(pair);
            results.push({
                id:               pair.id,
                image_pre:        pair.preA,
                image_post:       pair.postB,
                status:           "success",
                damage_label:     analysis.damage_label,
                confidence_score: analysis.confidence_score,
                justification:    analysis.justification,
            });
            console.log(`OK  ${analysis.damage_label} (${analysis.confidence_score})`);
        } catch (err) {
            results.push({
                id:         pair.id,
                image_pre:  pair.preA,
                image_post: pair.postB,
                status:     "error",
                error:      err.message || String(err),
            });
            console.log(`FAIL  ${err.message}`);
        }

        if (i < pairs.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    const successful = results.filter(r => r.status === "success");
    const failed     = results.filter(r => r.status === "error");

    console.log("\n============== SUMMARY ==============");
    console.log(`Total pairs processed : ${pairs.length}`);
    console.log(`Successful            : ${successful.length}`);
    console.log(`Failed                : ${failed.length}`);

    if (successful.length > 0) {
        const labelCounts = successful.reduce((acc, r) => {
            acc[r.damage_label] = (acc[r.damage_label] || 0) + 1;
            return acc;
        }, {});
        console.log("\nDamage breakdown:");
        for (const [label, count] of Object.entries(labelCounts)) {
            console.log(`  ${label.padEnd(15)} ${count}`);
        }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${OUTPUT_FILE}`);
}

runBatch();