import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import fs from "fs";
import path from "path";

const client = new BedrockRuntimeClient({ region: "us-east-1" });

function getFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return "png";
    if (ext === '.webp') return "webp";
    if (ext === '.gif') return "gif";
    return "jpeg";
}

async function runDisasterAnalysis() {
    const imageAPath = process.argv[2];
    const imageBPath = process.argv[3];

    if (!imageAPath || !imageBPath) {
        console.error("Error: Please provide both Image A and Image B.");
        console.log("Usage: node index.mjs <path_to_image_A> <path_to_image_B>");
        return;
    }

    console.log(`Loading Image A (Pre-disaster): ${imageAPath}`);
    console.log(`Loading Image B (Post-disaster): ${imageBPath}`);

    try {
        const imageABytes = fs.readFileSync(imageAPath);
        const imageBBytes = fs.readFileSync(imageBPath);

        const userPrompt = `You are an expert disaster response analyst. Analyze the provided pre-disaster (Image A) and post-disaster (Image B) images of the same building. 

Assess the level of structural damage sustained using the following classification schema:
No Damage: The building appears undisturbed with no visible structural changes or debris.
Minor Damage: Superficial damage, minor roof damage (e.g., missing shingles), or small amounts of debris. The core structure remains intact.
Major Damage: Significant structural failure, partial building collapse, or substantial roof/wall loss.
Destroyed: Complete or near-complete collapse of the building; only the foundation or a rubble pile remains.

Based on your comparative visual analysis, provide your response strictly in the following JSON format:

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
                    { image: { format: getFormat(imageAPath), source: { bytes: imageABytes } } },
                    { text: "Image B (Post-disaster):" },
                    { image: { format: getFormat(imageBPath), source: { bytes: imageBBytes } } },
                    { text: userPrompt },
                ],
            },
        ];

        console.log("\nAnalyzing damage with Gemma 3 12B...");

        const command = new ConverseCommand({
            modelId: "google.gemma-3-12b-it", // change model as needed
            messages: messages,
            inferenceConfig: {
                maxTokens: 1000,
                temperature: 0 // lower temperature for more deterministic output
            }
        });

        const response = await client.send(command);

        const resultText = response.output.message.content[0].text;

        console.log("\n--- JSON Result ---");
        console.log(resultText);
        console.log("-------------------\n");

    } catch (error) {
        console.error("\nError executing script:", error.message || error);
    }
}

runDisasterAnalysis();