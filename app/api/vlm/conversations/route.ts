import { NextResponse } from "next/server"
import { createConversation, listConversations } from "@/lib/chat-store"
import { getAuthenticatedUserId } from "@/lib/auth-server"

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unauthorized"
  if (message.includes("Authorization") || message.includes("token")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json({ error: "Failed to authenticate user" }, { status: 401 })
}

export async function GET(req: Request) {
  try {
    const userId = await getAuthenticatedUserId(req)
    const conversations = await listConversations(userId, "vlm")
    return NextResponse.json({ conversations })
  } catch (error) {
    return authErrorResponse(error)
  }
}

export async function POST(req: Request) {
  try {
    const userId = await getAuthenticatedUserId(req)
    const body = await req.json().catch(() => ({}))
    const title =
      typeof body?.title === "string" && body.title.trim().length > 0
        ? body.title.trim()
        : "New VLM Chat"
    const conversation = await createConversation(userId, title, "vlm")
    return NextResponse.json({ conversation }, { status: 201 })
  } catch (error) {
    return authErrorResponse(error)
  }
}
