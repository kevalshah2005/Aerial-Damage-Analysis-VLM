import { NextRequest, NextResponse } from "next/server"
import {
  assertConversationOwnership,
  deleteConversation,
  getConversationMessages,
  updateConversationTitle,
} from "@/lib/chat-store"
import { getAuthenticatedUserId } from "@/lib/auth-server"

function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed"
  if (message.includes("Authorization") || message.includes("token")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (message === "Conversation not found") {
    return NextResponse.json({ error: message }, { status: 404 })
  }
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(req)
    const { conversationId } = await params
    const conversation = await assertConversationOwnership(conversationId, userId)
    const messages = await getConversationMessages(conversationId)
    return NextResponse.json({ conversation, messages })
  } catch (error) {
    return handleError(error)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(req)
    const { conversationId } = await params
    await assertConversationOwnership(conversationId, userId)
    const body = await req.json()
    const title = typeof body?.title === "string" ? body.title.trim() : ""
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 })
    }
    await updateConversationTitle(conversationId, title)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(req)
    const { conversationId } = await params
    await assertConversationOwnership(conversationId, userId)
    await deleteConversation(conversationId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}
