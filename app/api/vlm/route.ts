import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime"

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" })
const MODEL_ID = process.env.VLM_MODEL_ID ?? "qwen.qwen3-vl-235b-a22b"

type ImagePart = {
  base64: string
  mediaType: string
}

export async function POST(req: Request) {
  try {
    const { text, images }: { text: string; images: ImagePart[] } = await req.json()

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
          text: `You are an expert aerial imagery analyst specializing in disaster damage assessment.
Analyze the provided image(s) and respond to the user's question with clear, technically accurate observations.
Focus on structural damage, land changes, and visual evidence. Be concise and specific.`,
        },
      ],
      inferenceConfig: { maxTokens: 1024, temperature: 0.2 },
    })

    const response = await client.send(command)
    const outputText = response.output?.message?.content?.[0]?.text ?? ""

    return Response.json({ text: outputText })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed"
    return Response.json({ error: message }, { status: 500 })
  }
}
