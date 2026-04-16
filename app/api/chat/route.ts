import { streamText, convertToModelMessages } from "ai"
import { bedrock } from "@ai-sdk/amazon-bedrock"
import {
  appendMessage,
  assertConversationOwnership,
  generateConversationTitleFromMessage,
  updateConversationMetadata,
  updateConversationTitle,
} from "@/lib/chat-store"
import { getAuthenticatedUserId } from "@/lib/auth-server"

export async function POST(req: Request) {
  try {
    const userId = await getAuthenticatedUserId(req)
    const { messages, conversationId } = await req.json()
    if (!conversationId || typeof conversationId !== "string") {
      return Response.json({ error: "conversationId is required" }, { status: 400 })
    }

    const conversation = await assertConversationOwnership(conversationId, userId)
    const modelId = process.env.BEDROCK_MODEL_ID
    if (!modelId) {
      throw new Error("Missing BEDROCK_MODEL_ID environment variable")
    }

    const latestUserMessage =
      messages
        .slice()
        .reverse()
        .find((message: { role: string }) => message.role === "user") ?? null
    const latestUserText =
      latestUserMessage?.parts
        ?.filter((part: { type: string }) => part.type === "text")
        .map((part: { text: string }) => part.text)
        .join("")
        .trim() ?? ""

    if (latestUserText) {
      await appendMessage({
        conversationId,
        userId,
        role: "user",
        content: latestUserText,
        modelId,
      })
      const now = new Date().toISOString()
      await updateConversationMetadata({
        conversationId,
        updatedAt: now,
        lastMessagePreview: latestUserText.slice(0, 180),
        incrementMessageCountBy: 1,
      })

      if (conversation.title === "New Chat") {
        await updateConversationTitle(
          conversationId,
          generateConversationTitleFromMessage(latestUserText)
        )
      }
    }

    const result = streamText({
      model: bedrock(modelId),
    system: `You are GeoView AI, an expert assistant specializing in geospatial data, aerial imagery, satellite remote sensing, and geographic information systems (GIS). 

Your knowledge covers:
- Aerial and satellite imagery interpretation
- Remote sensing techniques and technologies
- LiDAR, multispectral, and hyperspectral imaging
- GIS analysis and mapping
- Land use/land cover classification
- Terrain analysis and digital elevation models
- Environmental monitoring and change detection
- Urban planning and infrastructure analysis
- Agricultural monitoring and precision farming
- Natural disaster assessment and monitoring

Provide clear, concise, and technically accurate responses. When relevant, mention specific tools, datasets, or methodologies commonly used in the geospatial industry. Format responses with paragraphs for readability. Keep responses focused and under 300 words unless the user asks for more detail.`,
      messages: await convertToModelMessages(messages),
      onFinish: async ({ text }) => {
        const assistantText = text.trim()
        if (!assistantText) return
        const now = new Date().toISOString()
        await appendMessage({
          conversationId,
          userId,
          role: "assistant",
          content: assistantText,
          modelId,
        })
        await updateConversationMetadata({
          conversationId,
          updatedAt: now,
          lastMessagePreview: assistantText.slice(0, 180),
          incrementMessageCountBy: 1,
        })
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed"
    if (message.includes("Authorization") || message.includes("token")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (message === "Conversation not found") {
      return Response.json({ error: message }, { status: 404 })
    }
    return Response.json({ error: message }, { status: 400 })
  }
}
