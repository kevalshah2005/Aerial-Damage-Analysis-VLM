'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthenticator } from '@aws-amplify/ui-react'
import {
  Send,
  ImagePlus,
  X,
  Bot,
  User,
  Satellite,
  Scan,
  Layers,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import DashboardHeader from '@/components/dashboard-header'

const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

type AttachedImage = {
  id: string
  file: File
  previewUrl: string
  name: string
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: AttachedImage[]
}

const SUGGESTED_PROMPTS = [
  {
    icon: <Scan className="h-3.5 w-3.5" />,
    text: 'Identify damage patterns in this aerial image',
  },
  {
    icon: <Layers className="h-3.5 w-3.5" />,
    text: 'Compare pre and post-event imagery for structural changes',
  },
  {
    icon: <Satellite className="h-3.5 w-3.5" />,
    text: 'Classify building damage severity across the image',
  },
]

export default function VLMPage() {
  const { authStatus } = useAuthenticator(context => [context.authStatus])
  const router = useRouter()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  if (!skipAuth && (authStatus === 'configuring' || authStatus === 'unauthenticated')) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const addImages = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
    const newImages: AttachedImage[] = imageFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
    }))
    setAttachedImages(prev => [...prev, ...newImages])
  }

  const removeImage = (id: string) => {
    setAttachedImages(prev => {
      const img = prev.find(i => i.id === id)
      if (img) URL.revokeObjectURL(img.previewUrl)
      return prev.filter(i => i.id !== id)
    })
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text && attachedImages.length === 0) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      images: attachedImages.length > 0 ? [...attachedImages] : undefined,
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachedImages([])

    // Placeholder — VLM response will go here
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'VLM analysis coming soon. This interface will connect to your AWS-hosted vision model to analyze uploaded imagery.',
        },
      ])
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 800)

    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    addImages(e.dataTransfer.files)
  }, [])

  const handleSuggest = (text: string) => {
    setInput(text)
    textareaRef.current?.focus()
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <DashboardHeader />

      <div
        className="flex flex-1 min-h-0 flex-col relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg m-2">
            <div className="flex flex-col items-center gap-3 text-primary">
              <ImagePlus className="h-10 w-10" />
              <p className="text-sm font-semibold tracking-wide">Drop images to attach</p>
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full gap-8 px-4 pb-8">
              {/* Empty state */}
              <div className="flex flex-col items-center gap-4 text-center max-w-md">
                <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20">
                  <Satellite className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-foreground">VLM Image Analysis</h2>
                  <p className="text-sm text-muted-foreground mt-1.5">
                    Upload aerial imagery and ask questions. The vision model will analyze structural damage, land changes, and more.
                  </p>
                </div>
              </div>

              {/* Suggested prompts */}
              <div className="flex flex-col gap-2 w-full max-w-lg">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest text-center mb-1">
                  Suggested
                </p>
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggest(p.text)}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card border border-border text-left text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
                  >
                    <span className="text-primary shrink-0">{p.icon}</span>
                    {p.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-4 py-6 max-w-3xl mx-auto w-full">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* Avatar */}
                  <div className={`shrink-0 flex items-center justify-center h-7 w-7 rounded-lg border ${
                    msg.role === 'user'
                      ? 'bg-primary/15 border-primary/20 text-primary'
                      : 'bg-secondary border-border text-muted-foreground'
                  }`}>
                    {msg.role === 'user'
                      ? <User className="h-3.5 w-3.5" />
                      : <Bot className="h-3.5 w-3.5" />
                    }
                  </div>

                  {/* Bubble */}
                  <div className={`flex flex-col gap-2 max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {/* Images */}
                    {msg.images && msg.images.length > 0 && (
                      <div className={`flex flex-wrap gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.images.map(img => (
                          <div key={img.id} className="relative rounded-lg overflow-hidden border border-border">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.previewUrl}
                              alt={img.name}
                              className="h-36 w-auto max-w-xs object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Text */}
                    {msg.text && (
                      <div className={`px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-primary/15 text-foreground border border-primary/20'
                          : 'bg-card text-foreground border border-border'
                      }`}>
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Sparkles className="h-3 w-3 text-primary" />
                            <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">VLM</span>
                          </div>
                        )}
                        {msg.text}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-border bg-card/50 backdrop-blur-md px-4 py-3">
          <div className="max-w-3xl mx-auto w-full flex flex-col gap-2">
            {/* Attached image previews */}
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedImages.map(img => (
                  <div key={img.id} className="relative group rounded-lg overflow-hidden border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.previewUrl}
                      alt={img.name}
                      className="h-16 w-auto max-w-[8rem] object-cover"
                    />
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute top-1 right-1 flex items-center justify-center h-4 w-4 rounded-full bg-background/80 text-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Text + actions row */}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => e.target.files && addImages(e.target.files)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 mb-0.5"
                onClick={() => fileInputRef.current?.click()}
                title="Attach images"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>

              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about the imagery… or drag & drop images anywhere"
                  rows={1}
                  className="w-full resize-none rounded-lg bg-background border border-border px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors max-h-40 overflow-y-auto"
                  style={{ minHeight: '40px' }}
                  onInput={e => {
                    const t = e.currentTarget
                    t.style.height = 'auto'
                    t.style.height = `${Math.min(t.scrollHeight, 160)}px`
                  }}
                />
              </div>

              <Button
                size="icon"
                className="h-9 w-9 shrink-0 mb-0.5 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-40"
                onClick={handleSend}
                disabled={!input.trim() && attachedImages.length === 0}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground text-center">
              Supports JPEG, PNG, GeoTIFF previews · Drag & drop to attach · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
