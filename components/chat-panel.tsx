"use client"

import React from "react"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import type { UIMessage } from "ai"
import { useRef, useEffect, useState, useCallback } from "react"
import { isToolUIPart } from "ai"
import type { MapAction } from "@/lib/map-actions"
import { fetchAuthSession } from "aws-amplify/auth"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Send,
  Bot,
  User,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Satellite,
  Mountain,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const SUGGESTED_QUESTIONS = [
  {
    icon: <MapPin className="h-3.5 w-3.5" />,
    text: "What do the Joplin pre/post aerial images suggest about the hardest-hit areas?",
  },
  {
    icon: <Satellite className="h-3.5 w-3.5" />,
    text: "Summarize the Joplin damage subtype counts and what they imply for response priorities.",
  },
  {
    icon: <Mountain className="h-3.5 w-3.5" />,
    text: "Based on the Joplin references, what are the key verified facts and where do sources differ?",
  },
]

function getMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

type Conversation = {
  conversationId: string
  title: string
  updatedAt: string
}

type StoredMessage = {
  messageId: string
  role: "user" | "assistant" | "system"
  content: string
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const session = await fetchAuthSession()
  const token = session.tokens?.idToken?.toString()
  if (!token) {
    throw new Error("No auth token available")
  }
  return { Authorization: `Bearer ${token}` }
}

export default function ChatPanel({
  onMapAction,
  onConversationChange,
}: {
  onMapAction?: (action: MapAction) => void
  onConversationChange?: () => void
}) {
  const [input, setInput] = useState("")
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [editingConversationId, setEditingConversationId] = useState<string | null>(
    null
  )
  const [editingTitle, setEditingTitle] = useState("")
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  )
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollToBottom = React.useCallback(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [])

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
      }),
    []
  )

  const loadConversations = React.useCallback(async () => {
    const headers = await getAuthHeader()
    const res = await fetch("/api/chat/conversations", { headers })
    if (!res.ok) {
      throw new Error("Failed to load conversations")
    }
    const data = await res.json()
    setConversations(data.conversations ?? [])
    return data.conversations ?? []
  }, [])

  const createConversation = React.useCallback(async () => {
    const headers = await getAuthHeader()
    const res = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      throw new Error("Failed to create conversation")
    }
    const data = await res.json()
    return data.conversation as Conversation
  }, [])

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
    onFinish: async () => {
      await loadConversations()
    },
  })

  const isStreaming = status === "streaming"
  const executedToolCallIds = useRef<Set<string>>(new Set())

  // Execute map actions from tool invocations in completed assistant messages
  const onMapActionRef = useRef(onMapAction)
  useEffect(() => { onMapActionRef.current = onMapAction }, [onMapAction])

  useEffect(() => {
    if (!onMapActionRef.current) return
    for (const message of messages) {
      if (message.role !== "assistant" || !message.parts) continue
      for (const part of message.parts) {
        // AI SDK v6: tool parts have type "tool-{name}", state "output-available", and flat input/output
        if (!isToolUIPart(part) || part.state !== "output-available") continue
        if (executedToolCallIds.current.has(part.toolCallId)) continue

        executedToolCallIds.current.add(part.toolCallId)
        const toolName = (part.type as string).slice(5) // strip "tool-" prefix
        const args = part.input as Record<string, unknown>

        let action: MapAction | null = null
        if (toolName === "fly_to") action = { type: "fly_to", ...args } as MapAction
        else if (toolName === "fit_bounds") action = { type: "fit_bounds", ...args } as MapAction
        else if (toolName === "set_zoom") action = { type: "set_zoom", ...args } as MapAction
        else if (toolName === "set_base_layer") action = { type: "set_base_layer", ...args } as MapAction
        else if (toolName === "toggle_layer") action = { type: "toggle_layer", ...args } as MapAction
        else if (toolName === "set_layer_opacity") action = { type: "set_layer_opacity", ...args } as MapAction
        else if (toolName === "place_marker") action = { type: "place_marker", ...args } as MapAction
        else if (toolName === "clear_markers") action = { type: "clear_markers" }
        else if (toolName === "fit_to_dataset") action = { type: "fit_to_dataset" }

        if (action) onMapActionRef.current(action)
      }
    }
  }, [messages])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await loadConversations()
        if (cancelled) return
        if (loaded.length === 0) {
          const created = await createConversation()
          if (cancelled) return
          setConversations([created])
          setActiveConversationId(created.conversationId)
        } else {
          setActiveConversationId(loaded[0].conversationId)
        }
      } catch {
        if (!cancelled) {
          setConversations([])
        }
      } finally {
        if (!cancelled) {
          setLoadingConversations(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [createConversation, loadConversations])

  useEffect(() => {
    if (!activeConversationId) return
    let cancelled = false
    ;(async () => {
      setLoadingMessages(true)
      try {
        const headers = await getAuthHeader()
        const res = await fetch(`/api/chat/conversations/${activeConversationId}`, {
          headers,
        })
        if (!res.ok) {
          throw new Error("Failed to fetch conversation")
        }
        const data = await res.json()
        const initialMessages: UIMessage[] = (data.messages as StoredMessage[]).map(
          (message) => {
            const toolParts = (message.toolCalls ?? []).map((tc) => ({
              type: `tool-${tc.toolName}` as const,
              toolCallId: tc.toolCallId,
              state: "output-available" as const,
              input: tc.input,
              output: { ok: true },
            }))
            return {
              id: message.messageId,
              role: message.role,
              parts: [...toolParts, { type: "text" as const, text: message.content }],
            }
          }
        )
        if (!cancelled) {
          // Pre-suppress session-only tool calls so they don't re-fire on load
          const SESSION_ONLY_TOOLS = new Set(["place_marker", "clear_markers"])
          for (const msg of initialMessages) {
            for (const part of msg.parts ?? []) {
              if (typeof (part as { type?: string }).type === "string" && (part as { type: string }).type.startsWith("tool-")) {
                const toolName = (part as { type: string }).type.slice(5)
                if (SESSION_ONLY_TOOLS.has(toolName)) {
                  executedToolCallIds.current.add((part as { toolCallId: string }).toolCallId)
                }
              }
            }
          }
          setMessages(initialMessages)
          // Ensure older chats open at the latest message, not top.
          requestAnimationFrame(() => requestAnimationFrame(scrollToBottom))
          await loadConversations()
        }
      } catch {
        if (!cancelled) setMessages([])
      } finally {
        if (!cancelled) setLoadingMessages(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeConversationId, setMessages, loadConversations])

  useEffect(() => {
    if (loadingMessages) return
    requestAnimationFrame(() => requestAnimationFrame(scrollToBottom))
  }, [activeConversationId, loadingMessages, scrollToBottom])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isStreaming || !activeConversationId) return
    const text = input
    setInput("")
    const headers = await getAuthHeader()
    await sendMessage(
      { text },
      {
        headers,
        body: { conversationId: activeConversationId },
      }
    )
  }

  const handleSuggestion = async (text: string) => {
    if (!activeConversationId || isStreaming) return
    const headers = await getAuthHeader()
    await sendMessage(
      { text },
      {
        headers,
        body: { conversationId: activeConversationId },
      }
    )
  }

  const handleNewChat = async () => {
    if (isStreaming) return
    onConversationChange?.()
    executedToolCallIds.current = new Set()
    const created = await createConversation()
    setConversations((prev) => [created, ...prev])
    setActiveConversationId(created.conversationId)
    setMessages([])
  }

  const handleDeleteConversation = async (conversationId: string) => {
    if (isStreaming) return
    const shouldDelete = window.confirm("Delete this chat permanently?")
    if (!shouldDelete) return

    const headers = await getAuthHeader()
    const res = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: "DELETE",
      headers,
    })
    if (!res.ok) {
      return
    }

    const remaining = conversations.filter(
      (conversation) => conversation.conversationId !== conversationId
    )
    setConversations(remaining)

    if (remaining.length === 0) {
      onConversationChange?.()
      executedToolCallIds.current = new Set()
      const created = await createConversation()
      setConversations([created])
      setActiveConversationId(created.conversationId)
      setMessages([])
      return
    }

    if (activeConversationId === conversationId) {
      onConversationChange?.()
      executedToolCallIds.current = new Set()
      setActiveConversationId(remaining[0].conversationId)
    }
  }

  const commitRenameConversation = async (conversationId: string) => {
    const trimmed = editingTitle.trim()
    if (!trimmed) {
      setEditingConversationId(null)
      setEditingTitle("")
      return
    }
    const headers = await getAuthHeader()
    const res = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ title: trimmed }),
    })
    if (!res.ok) {
      setEditingConversationId(null)
      setEditingTitle("")
      return
    }

    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.conversationId === conversationId
          ? { ...conversation, title: trimmed }
          : conversation
      )
    )
    setEditingConversationId(null)
    setEditingTitle("")
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/15">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">GeoView AI</h2>
            <p className="text-[10px] text-muted-foreground">
              Ask about aerial imagery & geospatial data
            </p>
          </div>
        </div>
        <Button
          onClick={handleNewChat}
          disabled={isStreaming || loadingConversations}
          className="w-full h-8 text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New chat
        </Button>
        <div className="max-h-32 overflow-y-auto space-y-1">
          {conversations.map((conversation) => (
            <div
              key={conversation.conversationId}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs border transition-colors ${
                activeConversationId === conversation.conversationId
                  ? "bg-primary/15 border-primary/30 text-foreground"
                  : "bg-secondary border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className="flex-1 min-w-0">
                {editingConversationId === conversation.conversationId ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => commitRenameConversation(conversation.conversationId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void commitRenameConversation(conversation.conversationId)
                      }
                      if (e.key === "Escape") {
                        setEditingConversationId(null)
                        setEditingTitle("")
                      }
                    }}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      if (conversation.conversationId === activeConversationId) return
                      onConversationChange?.()
                      executedToolCallIds.current = new Set()
                      setActiveConversationId(conversation.conversationId)
                    }}
                    className="w-full text-left truncate"
                  >
                    {conversation.title || "New Chat"}
                  </button>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingConversationId(conversation.conversationId)
                  setEditingTitle(conversation.title || "New Chat")
                }}
                aria-label="Rename chat"
                className="p-1 rounded hover:bg-primary/10 hover:text-foreground transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDeleteConversation(conversation.conversationId)
                }}
                aria-label="Delete chat"
                className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {loadingConversations || loadingMessages ? (
          <div className="text-xs text-muted-foreground">Loading chat...</div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                Welcome to GeoView AI
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-[220px]">
                Ask questions about aerial imagery, satellite data, or
                geospatial analysis.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[280px] mt-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q.text}
                  onClick={() => handleSuggestion(q.text)}
                  className="flex items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground bg-secondary rounded-lg hover:bg-muted hover:text-foreground transition-colors border border-border"
                >
                  <span className="shrink-0 text-primary">{q.icon}</span>
                  <span>{q.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        {isStreaming &&
          messages.length > 0 &&
          messages[messages.length - 1].role === "user" && (
            <div className="flex items-start gap-2.5">
              <div className="flex items-center justify-center h-6 w-6 rounded-md bg-primary/15 shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-secondary rounded-xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.2s]" />
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.4s]" />
                </div>
              </div>
            </div>
          )}
      </div>

      {/* Input form */}
      <div className="px-4 pb-4 pt-2">
        <form onSubmit={handleSubmit} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about aerial imagery..."
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isStreaming || !activeConversationId}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg"
            aria-label="Send message"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Powered by AI. Responses may not be fully accurate.
        </p>
      </div>
    </div>
  )
}

const TOOL_META: Record<string, { label: string; icon: string }> = {
  fly_to:          { label: "Navigating map",     icon: "✈" },
  fit_bounds:      { label: "Adjusting view",      icon: "🗺" },
  set_zoom:        { label: "Setting zoom",         icon: "🔍" },
  set_base_layer:  { label: "Switching map style",  icon: "🗺" },
  toggle_layer:    { label: "Toggling layer",        icon: "👁" },
  set_layer_opacity: { label: "Adjusting opacity",  icon: "🎨" },
  place_marker:    { label: "Placing marker",        icon: "📍" },
  clear_markers:   { label: "Clearing markers",      icon: "🗑" },
  fit_to_dataset:  { label: "Zooming to dataset",    icon: "📡" },
  query_dataset:   { label: "Querying dataset",      icon: "📊" },
  web_search:      { label: "Searching the web",     icon: "🌐" },
}

function getToolParts(message: UIMessage) {
  if (!message.parts) return []
  return message.parts.filter(
    (p): p is typeof p & { type: string; toolCallId: string; state: string; input: unknown } =>
      typeof p.type === "string" && p.type.startsWith("tool-")
  )
}

function ToolStatusPills({ message }: { message: UIMessage }) {
  const toolParts = getToolParts(message)
  if (toolParts.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {toolParts.map((part) => {
        const toolName = (part.type as string).slice(5)
        const meta = TOOL_META[toolName] ?? { label: toolName, icon: "⚙" }
        const done = part.state === "output-available"
        return (
          <span
            key={part.toolCallId}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
              done
                ? "bg-muted/60 border-border text-muted-foreground"
                : "bg-primary/10 border-primary/30 text-primary"
            }`}
          >
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
            {!done && (
              <span className="flex gap-0.5 ml-0.5">
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
              </span>
            )}
            {done && <span className="ml-0.5 text-[9px] opacity-60">✓</span>}
          </span>
        )
      })}
    </div>
  )
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user"
  const text = getMessageText(message)

  return (
    <div
      className={`flex items-start gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <div
        className={`flex items-center justify-center h-6 w-6 rounded-md shrink-0 mt-0.5 ${
          isUser ? "bg-primary/25" : "bg-primary/15"
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-primary" />
        )}
      </div>
      <div
        className={`rounded-xl px-3 py-2 max-w-[85%] ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-secondary text-foreground rounded-tl-sm"
        }`}
      >
        {isUser ? (
          <p className="text-xs leading-relaxed whitespace-pre-wrap">{text}</p>
        ) : (
          <div className="text-xs leading-relaxed break-words">
            <ToolStatusPills message={message} />
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-sm font-semibold mt-2 mb-1 first:mt-0">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-sm font-semibold mt-2 mb-1 first:mt-0">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xs font-semibold mt-2 mb-1 first:mt-0">
                    {children}
                  </h3>
                ),
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => (
                  <ul className="list-disc ml-4 mb-2 last:mb-0">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal ml-4 mb-2 last:mb-0">{children}</ol>
                ),
                li: ({ children }) => <li className="mb-1">{children}</li>,
                strong: ({ children }) => (
                  <strong className="font-semibold">{children}</strong>
                ),
                code: ({ inline, children }) =>
                  inline ? (
                    <code className="px-1 py-0.5 rounded bg-muted text-[11px]">
                      {children}
                    </code>
                  ) : (
                    <code className="block p-2 rounded bg-muted text-[11px] overflow-x-auto">
                      {children}
                    </code>
                  ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
