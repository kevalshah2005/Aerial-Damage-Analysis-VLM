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
import { buildChatDataContext } from "@/lib/chat-context"

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

    const datasetContext = buildChatDataContext()

    const result = streamText({
      model: bedrock(modelId),
      system: `You are GeoView AI, a disaster-analysis assistant focused on the 2011 Joplin tornado.

Your primary job is to answer questions using this project's local Joplin context, including:
- Aerial pre/post-disaster imagery metadata and patch-level coverage
- Building damage labels and subtype counts from the local dataset summary
- Curated Joplin tornado reference notes (with source prioritization)

Behavior rules:
- Prioritize Joplin-specific answers over generic geospatial explanations.
- Ground responses in the provided local context whenever possible.
- Cite concrete values from the context (counts, percentages, timestamps, damage categories) when relevant.
- If the context does not contain enough evidence, say that clearly and ask for the exact missing input.
- Do not invent facts, sources, or statistics.
- When sources disagree, mention the discrepancy briefly and prefer official sources first (NWS/NOAA/FEMA/NIST), then secondary summaries.
- Keep answers concise and practical for damage assessment and decision support.

--- BEGIN LOCAL DISASTER CONTEXT ---
${datasetContext}
--- END LOCAL DISASTER CONTEXT ---

Provide clear, technically accurate responses in readable paragraphs. Keep responses focused and under 300 words unless the user asks for more detail.`,
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
