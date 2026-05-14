'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthenticator } from '@aws-amplify/ui-react'
import { fetchAuthSession } from 'aws-amplify/auth'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  Plus,
  Trash2,
  MessageSquare,
  Pencil,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  ShieldX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import DashboardHeader from '@/components/dashboard-header'

const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
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
  imageUrls?: string[]
}

type Conversation = {
  conversationId: string
  title: string
  updatedAt: string
  lastMessagePreview: string
}

type VLMResponse = {
  visual_analysis?: string
  damage_label?: string
  confidence_score?: number
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

const DAMAGE_CONFIG: Record<string, { color: string; bg: string; border: string; Icon: React.ElementType }> = {
  'No Damage':    { color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30', Icon: CheckCircle },
  'Minor Damage': { color: 'text-yellow-400',  bg: 'bg-yellow-400/10',  border: 'border-yellow-400/30',  Icon: AlertTriangle },
  'Major Damage': { color: 'text-red-400',     bg: 'bg-red-400/10',     border: 'border-red-400/30',     Icon: AlertCircle },
  'Destroyed':    { color: 'text-purple-400',  bg: 'bg-purple-400/10',  border: 'border-purple-400/30',  Icon: ShieldX },
}

function tryParseVLM(text: string): VLMResponse | null {
  const stripped = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  try {
    const parsed = JSON.parse(stripped)
    if (typeof parsed === 'object' && parsed !== null && ('visual_analysis' in parsed || 'damage_label' in parsed)) {
      return parsed as VLMResponse
    }
  } catch { /* not JSON */ }
  return null
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const session = await fetchAuthSession({ forceRefresh: true })
  const token = session.tokens?.idToken?.toString()
  if (!token) throw new Error("No auth token")
  return { Authorization: `Bearer ${token}` }
}

export default function VLMPage() {
  const { authStatus } = useAuthenticator(context => [context.authStatus])
  const router = useRouter()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [lightboxZoom, setLightboxZoom] = useState(1)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  const loadConversations = useCallback(async () => {
    if (skipAuth) return
    try {
      setLoadingConversations(true)
      const headers = await getAuthHeader()
      const res = await fetch('/api/vlm/conversations', { headers })
      if (res.ok) {
        const data = await res.json()
        setConversations(data.conversations ?? [])
      }
    } catch {
      // auth not ready
    } finally {
      setLoadingConversations(false)
    }
  }, [])

  useEffect(() => {
    if (!skipAuth && authStatus === 'authenticated') {
      loadConversations()
    }
  }, [authStatus, loadConversations])

  useEffect(() => {
    if (!skipAuth && authStatus === 'unauthenticated') router.push('/auth')
  }, [authStatus, router])

  const createNewConversation = async (): Promise<string | null> => {
    if (skipAuth) return null
    try {
      const headers = await getAuthHeader()
      const res = await fetch('/api/vlm/conversations', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New VLM Chat' }),
      })
      if (res.ok) {
        const data = await res.json()
        const conv = data.conversation as Conversation
        setConversations(prev => [conv, ...prev])
        return conv.conversationId
      }
    } catch { /* skip */ }
    return null
  }

  const loadConversation = async (conversationId: string) => {
    if (skipAuth) return
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`/api/vlm/conversations/${conversationId}`, { headers })
      if (res.ok) {
        const data = await res.json()
        const loaded: Message[] = (data.messages ?? []).map((m: { messageId: string; role: string; content: string; imageUrls?: string[] }) => ({
          id: m.messageId,
          role: m.role as 'user' | 'assistant',
          text: m.content,
          imageUrls: m.imageUrls,
        }))
        setMessages(loaded)
        setActiveConversationId(conversationId)
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      }
    } catch { /* skip */ }
  }

  const deleteConversation = async (conversationId: string) => {
    if (skipAuth) return
    try {
      const headers = await getAuthHeader()
      await fetch(`/api/vlm/conversations/${conversationId}`, { method: 'DELETE', headers })
      setConversations(prev => prev.filter(c => c.conversationId !== conversationId))
      if (activeConversationId === conversationId) {
        setMessages([])
        setActiveConversationId(null)
      }
    } catch { /* skip */ }
  }

  const commitRename = async (conversationId: string) => {
    const trimmed = editingTitle.trim()
    setEditingConversationId(null)
    setEditingTitle('')
    if (!trimmed) return
    try {
      const headers = await getAuthHeader()
      const res = await fetch(`/api/vlm/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (res.ok) {
        setConversations(prev => prev.map(c => c.conversationId === conversationId ? { ...c, title: trimmed } : c))
      }
    } catch { /* skip */ }
  }

  const startNewChat = () => {
    setMessages([])
    setActiveConversationId(null)
    setInput('')
    setAttachedImages([])
  }

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
      id: genId(),
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

  const fileToBase64 = (file: File): Promise<{ base64: string; mediaType: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(',')[1]
        resolve({ base64, mediaType: file.type || 'image/jpeg' })
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const handleSend = async () => {
    const text = input.trim()
    if (!text && attachedImages.length === 0) return

    const imagesToSend = [...attachedImages]
    const userMsg: Message = {
      id: genId(),
      role: 'user',
      text,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachedImages([])
    setIsLoading(true)
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    let convId = activeConversationId
    if (!convId && !skipAuth) {
      convId = await createNewConversation()
      if (convId) setActiveConversationId(convId)
    }

    try {
      const images = await Promise.all(imagesToSend.map(img => fileToBase64(img.file)))
      const authHeaders = skipAuth ? {} : await getAuthHeader().catch(() => ({}))
      const res = await fetch('/api/vlm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ text, images, conversationId: convId }),
      })

      const data = await res.json()
      const responseText = res.ok
        ? (data.text ?? 'No response from model.')
        : `Error: ${data.error ?? 'Request failed'}`

      setMessages(prev => [...prev, { id: genId(), role: 'assistant', text: responseText }])

      if (!skipAuth) loadConversations()
    } catch {
      setMessages(prev => [...prev, { id: genId(), role: 'assistant', text: 'Failed to reach the VLM. Check your connection and try again.' }])
    } finally {
      setIsLoading(false)
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleSuggest = (text: string) => {
    setInput(text)
    textareaRef.current?.focus()
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <DashboardHeader />

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => { setLightboxUrl(null); setLightboxZoom(1) }}
          onWheel={e => {
            e.preventDefault()
            setLightboxZoom(z => Math.min(5, Math.max(0.5, z - e.deltaY * 0.001)))
          }}
        >
          <div className="overflow-hidden flex items-center justify-center w-full h-full" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Full size"
              className="rounded-lg shadow-2xl object-contain select-none transition-transform duration-75"
              style={{ maxHeight: '90vh', maxWidth: '90vw', transform: `scale(${lightboxZoom})`, transformOrigin: 'center' }}
              draggable={false}
            />
          </div>
          {/* Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/80 backdrop-blur-sm rounded-full px-3 py-1.5 border border-border shadow-lg">
            <button
              className="flex items-center justify-center h-6 w-6 rounded-full hover:bg-muted text-foreground transition-colors text-sm font-bold"
              onClick={e => { e.stopPropagation(); setLightboxZoom(z => Math.max(0.5, z - 0.25)) }}
              title="Zoom out"
            >−</button>
            <button
              className="text-[11px] text-muted-foreground w-10 text-center tabular-nums hover:text-foreground transition-colors"
              onClick={e => { e.stopPropagation(); setLightboxZoom(1) }}
              title="Reset zoom"
            >{Math.round(lightboxZoom * 100)}%</button>
            <button
              className="flex items-center justify-center h-6 w-6 rounded-full hover:bg-muted text-foreground transition-colors text-sm font-bold"
              onClick={e => { e.stopPropagation(); setLightboxZoom(z => Math.min(5, z + 0.25)) }}
              title="Zoom in"
            >+</button>
          </div>
          <button
            className="absolute top-4 right-4 flex items-center justify-center h-8 w-8 rounded-full bg-background/80 text-foreground hover:bg-background transition-colors"
            onClick={() => { setLightboxUrl(null); setLightboxZoom(1) }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        {!skipAuth && (
          <div className="w-56 shrink-0 flex flex-col border-r border-border bg-card/50 backdrop-blur-md">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">History</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10"
                onClick={startNewChat}
                title="New chat"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {loadingConversations ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : conversations.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center px-3 py-6">No past chats</p>
              ) : (
                conversations.map(conv => (
                  <div
                    key={conv.conversationId}
                    className={`group flex items-center gap-1 px-2 py-2 cursor-pointer transition-colors ${
                      activeConversationId === conv.conversationId
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => {
                      if (editingConversationId !== conv.conversationId) loadConversation(conv.conversationId)
                    }}
                  >
                    <MessageSquare className="h-3 w-3 shrink-0" />
                    <div className="flex-1 min-w-0">
                      {editingConversationId === conv.conversationId ? (
                        <input
                          autoFocus
                          value={editingTitle}
                          onChange={e => setEditingTitle(e.target.value)}
                          onBlur={() => commitRename(conv.conversationId)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); void commitRename(conv.conversationId) }
                            if (e.key === 'Escape') { setEditingConversationId(null); setEditingTitle('') }
                          }}
                          className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:ring-0"
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-xs truncate block">{conv.title}</span>
                      )}
                    </div>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity p-0.5"
                      onClick={e => { e.stopPropagation(); setEditingConversationId(conv.conversationId); setEditingTitle(conv.title) }}
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-0.5"
                      onClick={e => { e.stopPropagation(); deleteConversation(conv.conversationId) }}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Main chat area */}
        <div
          className="flex flex-1 min-h-0 flex-col relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
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
              <div className="flex flex-col gap-7 px-4 py-6 max-w-3xl mx-auto w-full">
                {messages.map(msg => (
                  <MessageRow key={msg.id} msg={msg} onImageClick={url => { setLightboxUrl(url); setLightboxZoom(1) }} />
                ))}
                {isLoading && (
                  <div className="flex gap-3">
                    <div className="shrink-0 flex items-center justify-center h-7 w-7 rounded-lg border bg-secondary border-border text-muted-foreground">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                    <div className="px-3.5 py-2.5 rounded-xl bg-card border border-border flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="shrink-0 border-t border-border bg-card/50 backdrop-blur-md px-4 py-3">
            <div className="max-w-3xl mx-auto w-full flex flex-col gap-2">
              {attachedImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map(img => (
                    <div key={img.id} className="relative group rounded-lg overflow-hidden border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.previewUrl} alt={img.name} className="h-16 w-auto max-w-[8rem] object-cover" />
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
                  onClick={() => void handleSend()}
                  disabled={isLoading || (!input.trim() && attachedImages.length === 0)}
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
    </div>
  )
}

function MessageRow({ msg, onImageClick }: { msg: Message; onImageClick: (url: string) => void }) {
  const isUser = msg.role === 'user'
  const vlm = !isUser ? tryParseVLM(msg.text) : null

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`shrink-0 flex items-center justify-center h-7 w-7 rounded-lg border ${
        isUser
          ? 'bg-primary/15 border-primary/20 text-primary'
          : 'bg-secondary border-border text-muted-foreground'
      }`}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div className={`flex flex-col gap-2 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        {(msg.images?.length || msg.imageUrls?.length) ? (
          <div className={`flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {msg.images?.map(img => (
              <button
                key={img.id}
                className="relative rounded-lg overflow-hidden border border-border hover:opacity-90 hover:ring-2 hover:ring-primary/40 transition-all cursor-zoom-in"
                onClick={() => onImageClick(img.previewUrl)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.previewUrl} alt={img.name} className="h-36 w-auto max-w-xs object-cover" />
              </button>
            ))}
            {msg.imageUrls?.map((url, i) => (
              <button
                key={i}
                className="relative rounded-lg overflow-hidden border border-border hover:opacity-90 hover:ring-2 hover:ring-primary/40 transition-all cursor-zoom-in"
                onClick={() => onImageClick(url)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`image-${i}`} className="h-36 w-auto max-w-xs object-cover" />
              </button>
            ))}
          </div>
        ) : null}

        {msg.text && (
          isUser ? (
            <div className="px-3.5 py-2.5 rounded-xl text-sm leading-relaxed bg-primary/15 text-foreground border border-primary/20">
              <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.text}</p>
            </div>
          ) : vlm ? (
            <VLMResponseCard response={vlm} />
          ) : (
            <div className="px-3.5 py-2.5 rounded-xl text-sm leading-relaxed bg-card text-foreground border border-border">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">VLM</span>
              </div>
              <div className="text-xs leading-relaxed break-words">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => <h1 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-xs font-semibold mt-2 mb-1 first:mt-0">{children}</h3>,
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc ml-4 mb-2 last:mb-0">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 last:mb-0">{children}</ol>,
                    li: ({ children }) => <li className="mb-1">{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
                      inline ? (
                        <code className="px-1 py-0.5 rounded bg-muted text-[11px]">{children}</code>
                      ) : (
                        <code className="block p-2 rounded bg-muted text-[11px] overflow-x-auto">{children}</code>
                      ),
                    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">{children}</a>,
                  }}
                >
                  {msg.text}
                </ReactMarkdown>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}

function VLMResponseCard({ response }: { response: VLMResponse }) {
  const label = response.damage_label ?? 'Unknown'
  const config = DAMAGE_CONFIG[label]
  const Icon = config?.Icon ?? AlertCircle
  const score = response.confidence_score ?? 0

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden min-w-[280px] max-w-[420px]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <Sparkles className="h-3 w-3 text-primary" />
        <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">VLM Analysis</span>
      </div>

      {/* Damage label */}
      <div className={`flex items-center gap-3 px-4 py-3 ${config?.bg ?? 'bg-muted/20'} border-b border-border`}>
        <Icon className={`h-5 w-5 shrink-0 ${config?.color ?? 'text-muted-foreground'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-0.5">Damage Label</div>
          <div className={`text-base font-bold leading-tight ${config?.color ?? 'text-foreground'}`}>{label}</div>
        </div>
        {score > 0 && (
          <div className="text-right shrink-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-0.5">Confidence</div>
            <div className={`text-xl font-black ${config?.color ?? 'text-foreground'}`}>{score}%</div>
          </div>
        )}
      </div>

      {/* Confidence bar */}
      {score > 0 && (
        <div className="px-4 py-2 border-b border-border">
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                score >= 80 ? 'bg-emerald-400' : score >= 60 ? 'bg-amber-400' : 'bg-red-400'
              }`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
      )}

      {/* Visual analysis */}
      {response.visual_analysis && (
        <div className="px-4 py-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-1.5">Visual Analysis</div>
          <p className="text-xs text-foreground leading-relaxed">{response.visual_analysis}</p>
        </div>
      )}
    </div>
  )
}
