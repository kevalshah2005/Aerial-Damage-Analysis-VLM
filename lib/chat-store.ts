import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { getDdbClient } from "@/lib/dynamodb"

const USER_UPDATED_AT_INDEX = "UserUpdatedAtIndex"

function getTableNames() {
  const conversationsTable = process.env.DDB_CONVERSATIONS_TABLE
  const messagesTable = process.env.DDB_MESSAGES_TABLE
  if (!conversationsTable || !messagesTable) {
    throw new Error(
      "Missing DynamoDB environment variables: DDB_CONVERSATIONS_TABLE and DDB_MESSAGES_TABLE"
    )
  }
  return { conversationsTable, messagesTable }
}

export type ChatRole = "system" | "user" | "assistant"

export type Conversation = {
  conversationId: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
  lastMessagePreview: string
  messageCount: number
}

export type ChatMessage = {
  conversationId: string
  createdAt: string
  messageId: string
  userId: string
  role: ChatRole
  content: string
  modelId?: string
}

export async function createConversation(
  userId: string,
  title = "New Chat"
): Promise<Conversation> {
  const { conversationsTable } = getTableNames()
  const ddb = getDdbClient()
  const now = new Date().toISOString()
  const conversation: Conversation = {
    conversationId: crypto.randomUUID(),
    userId,
    title,
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: "",
    messageCount: 0,
  }

  await ddb.send(
    new PutCommand({
      TableName: conversationsTable,
      Item: conversation,
    })
  )

  return conversation
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  const { conversationsTable } = getTableNames()
  const ddb = getDdbClient()
  const result = await ddb.send(
    new QueryCommand({
      TableName: conversationsTable,
      IndexName: USER_UPDATED_AT_INDEX,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId,
      },
      ScanIndexForward: false,
    })
  )

  return (result.Items as Conversation[] | undefined) ?? []
}

export async function getConversation(
  conversationId: string
): Promise<Conversation | null> {
  const { conversationsTable } = getTableNames()
  const ddb = getDdbClient()
  const result = await ddb.send(
    new GetCommand({
      TableName: conversationsTable,
      Key: { conversationId },
    })
  )
  return (result.Item as Conversation | undefined) ?? null
}

export async function assertConversationOwnership(
  conversationId: string,
  userId: string
): Promise<Conversation> {
  const conversation = await getConversation(conversationId)
  if (!conversation || conversation.userId !== userId) {
    throw new Error("Conversation not found")
  }
  return conversation
}

export async function getConversationMessages(
  conversationId: string
): Promise<ChatMessage[]> {
  const { messagesTable } = getTableNames()
  const ddb = getDdbClient()
  const result = await ddb.send(
    new QueryCommand({
      TableName: messagesTable,
      KeyConditionExpression: "conversationId = :conversationId",
      ExpressionAttributeValues: {
        ":conversationId": conversationId,
      },
      ScanIndexForward: true,
    })
  )
  return (result.Items as ChatMessage[] | undefined) ?? []
}

export async function appendMessage(input: {
  conversationId: string
  userId: string
  role: ChatRole
  content: string
  modelId?: string
}): Promise<ChatMessage> {
  const { messagesTable } = getTableNames()
  const ddb = getDdbClient()
  const message: ChatMessage = {
    conversationId: input.conversationId,
    createdAt: new Date().toISOString(),
    messageId: crypto.randomUUID(),
    userId: input.userId,
    role: input.role,
    content: input.content,
    modelId: input.modelId,
  }

  await ddb.send(
    new PutCommand({
      TableName: messagesTable,
      Item: message,
    })
  )

  return message
}

export async function updateConversationMetadata(input: {
  conversationId: string
  updatedAt: string
  lastMessagePreview: string
  incrementMessageCountBy?: number
}) {
  const { conversationsTable } = getTableNames()
  const ddb = getDdbClient()
  const increment = input.incrementMessageCountBy ?? 1
  await ddb.send(
    new UpdateCommand({
      TableName: conversationsTable,
      Key: { conversationId: input.conversationId },
      UpdateExpression:
        "SET updatedAt = :updatedAt, lastMessagePreview = :lastMessagePreview ADD messageCount :increment",
      ExpressionAttributeValues: {
        ":updatedAt": input.updatedAt,
        ":lastMessagePreview": input.lastMessagePreview,
        ":increment": increment,
      },
    })
  )
}

export async function updateConversationTitle(
  conversationId: string,
  title: string
) {
  const { conversationsTable } = getTableNames()
  const ddb = getDdbClient()
  await ddb.send(
    new UpdateCommand({
      TableName: conversationsTable,
      Key: { conversationId },
      UpdateExpression: "SET title = :title",
      ExpressionAttributeValues: {
        ":title": title,
      },
    })
  )
}

export async function deleteConversation(conversationId: string) {
  const { conversationsTable, messagesTable } = getTableNames()
  const ddb = getDdbClient()

  const messages = await getConversationMessages(conversationId)
  for (let i = 0; i < messages.length; i += 25) {
    const chunk = messages.slice(i, i + 25)
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [messagesTable]: chunk.map((message) => ({
            DeleteRequest: {
              Key: {
                conversationId: message.conversationId,
                createdAt: message.createdAt,
              },
            },
          })),
        },
      })
    )
  }

  await ddb.send(
    new DeleteCommand({
      TableName: conversationsTable,
      Key: { conversationId },
    })
  )
}

export function generateConversationTitleFromMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim()
  if (!normalized) return "New Chat"
  const base = normalized.slice(0, 60)
  return base.length < normalized.length ? `${base}...` : base
}
