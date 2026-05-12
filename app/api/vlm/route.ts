import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime"
import {
  appendMessage,
  assertConversationOwnership,
  updateConversationMetadata,
} from "@/lib/chat-store"
import { getAuthenticatedUserId } from "@/lib/auth-server"

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" })
const MODEL_ID = process.env.VLM_MODEL_ID ?? "qwen.qwen3-vl-235b-a22b"

type ImagePart = {
  base64: string
  mediaType: string
}

export async function POST(req: Request) {
  try {
    const { text, images, conversationId }: { text: string; images: ImagePart[]; conversationId?: string } = await req.json()

    if (!text && (!images || images.length === 0)) {
      return Response.json({ error: "text or images required" }, { status: 400 })
    }

    const bedrockContent: Parameters<typeof ConverseCommand>[0]["messages"][number]["content"] = []

    for (const img of images ?? []) {
      const bytes = Buffer.from(img.base64, "base64")
      const format = img.mediaType.split("/")[1] as "jpeg" | "png" | "webp" | "gif"
      bedrockContent.push({ image: { format, source: { bytes } } })
    }

    if (text) {
      bedrockContent.push({ text })
    }

    const command = new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: bedrockContent }],
      system: [
        {
          text: `You are an expert disaster response analyst comparing two aerial images: Image A (before) and Image B (after).

Your task is to classify damage based on the structural mass surviving in Image B:

No Damage: The building matches Image A. The roof is smooth and solid. Forgive slight global color shifts (e.g. brown to gray) or blur.
Minor Damage: The building is standing. You see obvious bright BLUE TARPS or distinct high-contrast white patches.
Major Damage: Massive failure. A large chunk of the building mass is visibly missing or caved-in.
Destroyed: Total loss. You see a flat light-gray concrete slab, bare dirt, or a chaotic smudge of rubble.

CRITICAL RULES:

FORGIVE SENSOR NOISE: These crops are low-res. Do not call it damage if the edges are slightly blurry or the color is slightly different. Smooth = No Damage.
THE MASS ANCHOR: If B shows a solid rectangle of a similar size to A, the building is STANDING.
THE MAJOR TRIGGER: Major Damage requires a visible 'dark break' or missing section of the footprint.

Respond strictly in this JSON format:
{
  "visual_analysis": "[Is the rectangle smooth and solid (No Damage), tarped (Minor), broken (Major), or gone (Destroyed)?]",
  "damage_label": "[Select exactly one: No Damage, Minor Damage, Major Damage, Destroyed]",
  "confidence_score": "[0-100%]"
}`,
        },
      ],
      inferenceConfig: { maxTokens: 1024, temperature: 0.2 },
    })

    const response = await client.send(command)
    const outputText = response.output?.message?.content?.[0]?.text ?? ""

    // Save to DynamoDB if conversationId provided (auth optional — skip silently if unavailable)
    if (conversationId) {
      try {
        const userId = await getAuthenticatedUserId(req)
        await assertConversationOwnership(conversationId, userId)
        const now = new Date().toISOString()
        const userContent = [
          images?.length ? `[${images.length} image(s) attached]` : "",
          text,
        ].filter(Boolean).join(" ")
        await appendMessage({ conversationId, userId, role: "user", content: userContent })
        await appendMessage({ conversationId, userId, role: "assistant", content: outputText, modelId: MODEL_ID })
        await updateConversationMetadata({
          conversationId,
          updatedAt: now,
          lastMessagePreview: outputText.slice(0, 180),
          incrementMessageCountBy: 2,
        })
      } catch {
        // Auth unavailable or conversation mismatch — proceed without saving
      }
    }

    return Response.json({ text: outputText })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed"
    return Response.json({ error: message }, { status: 500 })
  }
}
