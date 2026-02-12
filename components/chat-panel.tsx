"use client"

import React from "react"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import type { UIMessage } from "ai"
import { useRef, useEffect, useState } from "react"
import {
  Send,
  Bot,
  User,
  Sparkles,
  MapPin,
  Satellite,
  Mountain,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const SUGGESTED_QUESTIONS = [
  {
    icon: <MapPin className="h-3.5 w-3.5" />,
    text: "What can I learn from aerial imagery of urban areas?",
  },
  {
    icon: <Satellite className="h-3.5 w-3.5" />,
    text: "How is satellite imagery used in agriculture?",
  },
  {
    icon: <Mountain className="h-3.5 w-3.5" />,
    text: "Explain how LiDAR differs from aerial photography",
  },
]

function getMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

const transport = new DefaultChatTransport({
  api: "/api/chat",
})

export default function ChatPanel() {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status } = useChat({ transport })

  const isStreaming = status === "streaming"

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return
    sendMessage({ text: input })
    setInput("")
  }

  const handleSuggestion = (text: string) => {
    sendMessage({ text })
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Chat header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/15">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            GeoView AI
          </h2>
          <p className="text-[10px] text-muted-foreground">
            Ask about aerial imagery & geospatial data
          </p>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 ? (
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
            disabled={!input.trim() || isStreaming}
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
        <p className="text-xs leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  )
}
