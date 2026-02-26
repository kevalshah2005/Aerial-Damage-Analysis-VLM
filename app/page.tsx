"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuthenticator } from "@aws-amplify/ui-react"
import { UploadCloud, Trash2, ChevronLeft, ChevronRight } from "lucide-react"

import DashboardHeader from "@/components/dashboard-header"
import ChatPanel from "@/components/chat-panel"
import ImageryPairCard from "@/components/imagery-pair-card"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ImageryPair {
  id: string
  name: string
  preImage: string | null
  postImage: string | null
  damageLevel: string
}

export default function Page() {
  const { authStatus } = useAuthenticator(context => [context.authStatus])
  const router = useRouter()
  const [chatOpen, setChatOpen] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedPair, setSelectedPair] = useState<ImageryPair | null>(null)

  // Dynamic state for unlimited pairs
  const [pairs, setPairs] = useState<ImageryPair[]>([])
  
  // Track previous URLs for cleanup
  const prevUrlsRef = useRef<Set<string>>(new Set())

  // Clean up Blob URLs when pairs are removed or replaced
  useEffect(() => {
    const currentUrls = new Set<string>()
    pairs.forEach(p => {
      if (p.preImage) currentUrls.add(p.preImage)
      if (p.postImage) currentUrls.add(p.postImage)
    })

    // Find URLs that were in the previous set but are NOT in the current set
    const urlsToRemove = Array.from(prevUrlsRef.current).filter(url => !currentUrls.has(url))
    
    // Revoke them
    urlsToRemove.forEach(url => {
      try {
        URL.revokeObjectURL(url)
      } catch (e) {
        console.error("Failed to revoke URL", e)
      }
    })

    // Update the ref for the next render
    prevUrlsRef.current = currentUrls
  }, [pairs])

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/auth')
    }
  }, [authStatus, router])

  if (authStatus === 'configuring' || authStatus === 'unauthenticated') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground animate-pulse">
            Authenticating...
          </p>
        </div>
      </div>
    )
  }

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    // Pre-calculate batch groups
    const batchGroups: Record<string, { pre: string | null; post: string | null }> = {}
    files.forEach(file => {
      const fileName = file.name.toLowerCase()
      const preMatch = fileName.match(/(.+?)(?:_|-|\.)pre/i)
      const postMatch = fileName.match(/(.+?)(?:_|-|\.)post/i)
      
      let baseName = ""
      let isPre = false

      if (preMatch) {
        baseName = preMatch[1]
        isPre = true
      } else if (postMatch) {
        baseName = postMatch[1]
        isPre = false
      } else {
        baseName = fileName.split('.')[0]
        isPre = true
      }

      if (!batchGroups[baseName]) batchGroups[baseName] = { pre: null, post: null }
      if (isPre) batchGroups[baseName].pre = URL.createObjectURL(file)
      else batchGroups[baseName].post = URL.createObjectURL(file)
    })

    setPairs(prevPairs => {
      const updatedPairs = [...prevPairs]
      
      Object.entries(batchGroups).forEach(([baseName, data]) => {
        const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1).replace(/(_|-)/g, ' ')
        const existingIndex = updatedPairs.findIndex(p => p.name.toLowerCase() === displayName.toLowerCase())

        if (existingIndex !== -1) {
          const existing = updatedPairs[existingIndex]
          
          // Create a new object for immutability
          const updated = {
            ...existing,
            preImage: data.pre || existing.preImage,
            postImage: data.post || existing.postImage,
          }

          if (updated.preImage && updated.postImage && updated.damageLevel === "un-classified") {
            const levels = ["no-damage", "minor-damage", "major-damage", "destroyed"]
            updated.damageLevel = levels[Math.floor(Math.random() * levels.length)]
          }
          
          updatedPairs[existingIndex] = updated
        } else {
          let simulatedDamage = "un-classified"
          if (data.pre && data.post) {
            const levels = ["no-damage", "minor-damage", "major-damage", "destroyed"]
            simulatedDamage = levels[Math.floor(Math.random() * levels.length)]
          }

          updatedPairs.push({
            id: Math.random().toString(36).substr(2, 9),
            name: displayName,
            preImage: data.pre,
            postImage: data.post,
            damageLevel: simulatedDamage
          })
        }
      })

      return updatedPairs
    })
  }

  const handleDelete = (id: string) => {
    setPairs(prev => prev.filter(p => p.id !== id))
  }

  const clearAll = () => {
    setPairs([])
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <DashboardHeader
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(!chatOpen)}
      />

      {/* MAIN CONTENT ROW */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT SIDE: Gallery + Controls */}
        <div className="flex flex-col flex-1 min-w-0 p-4 lg:p-8 relative">
          
          {/* Top Controls */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex flex-col">
              <h2 className="text-xl font-bold tracking-tight">Imagery Analysis</h2>
              <p className="text-xs text-muted-foreground">
                View and analyze pre/post disaster aerial pairs
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <input
                type="file"
                multiple
                ref={fileInputRef}
                onChange={handleBulkUpload}
                className="hidden"
                accept="image/*"
              />
              <Button 
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                size="sm"
                className="h-9 gap-2 border-primary/20 bg-primary/5 hover:bg-primary/10 hover:text-primary transition-all"
              >
                <UploadCloud className="h-4 w-4" />
                <span>Bulk Upload</span>
              </Button>
              <Button 
                onClick={clearAll}
                variant="ghost" 
                size="sm"
                className="h-9 gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                <span>Clear All</span>
              </Button>
            </div>
          </div>

          {/* Carousel Section */}
          <div className="flex-1 flex items-center justify-center px-4 sm:px-12">
            {pairs.length > 0 ? (
              <Carousel
                opts={{
                  align: "start",
                  loop: true,
                }}
                className="w-full max-w-[1600px]"
              >
                <CarouselContent className="-ml-2 md:-ml-4">
                  {pairs.map((pair) => (
                    <CarouselItem 
                      key={pair.id} 
                      className="pl-2 md:pl-4 basis-full sm:basis-1/2 lg:basis-1/3 xl:basis-1/4"
                    >
                      <div className="p-1">
                        <ImageryPairCard
                          preImage={pair.preImage}
                          postImage={pair.postImage}
                          damageLevel={pair.damageLevel}
                          label={pair.name}
                          onDelete={() => handleDelete(pair.id)}
                          onView={() => setSelectedPair(pair)}
                        />
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <div className="hidden xl:block">
                  <CarouselPrevious className="h-12 w-12 -left-16 border-border bg-card hover:bg-accent" />
                  <CarouselNext className="h-12 w-12 -right-16 border-border bg-card hover:bg-accent" />
                </div>
                {/* Mobile/Tablet Controls - simpler placement */}
                <div className="xl:hidden flex justify-center gap-4 mt-8">
                  <CarouselPrevious className="static translate-y-0 h-10 w-10 border-border bg-card" />
                  <CarouselNext className="static translate-y-0 h-10 w-10 border-border bg-card" />
                </div>
              </Carousel>
            ) : (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-2xl w-full max-w-2xl aspect-[16/6] bg-muted/30 hover:bg-muted/50 hover:border-primary/50 transition-all cursor-pointer group"
              >
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <UploadCloud className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight">No imagery pairs loaded</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Click the Bulk Upload button or click here to get started
                </p>
              </div>
            )}
          </div>

          {/* Instructions Overlay/Footer */}
          <div className="mt-8 pt-6 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              <strong>Instructions:</strong> Use the <strong>Bulk Upload</strong> button to select multiple pre and post disaster images. 
              The system will automatically pair them if they share a common name (e.g., <code className="bg-muted px-1 rounded text-primary">site_A_pre.jpg</code> and <code className="bg-muted px-1 rounded text-primary">site_A_post.jpg</code>). 
              Scroll through the gallery to see the analysis for each site.
            </p>
          </div>

          {/* Large View Dialog */}
          <Dialog open={!!selectedPair} onOpenChange={(open) => !open && setSelectedPair(null)}>
            <DialogContent className="max-w-6xl w-[90vw] h-[90vh] flex flex-col p-0 overflow-hidden bg-card border-border">
              <DialogHeader className="p-4 border-b border-border shrink-0">
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-xl font-bold">{selectedPair?.name}</DialogTitle>
                  <div className={cn(
                    "text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mr-6",
                    selectedPair?.damageLevel === "no-damage" ? "bg-emerald-500/20 text-emerald-500" :
                    selectedPair?.damageLevel === "minor-damage" ? "bg-amber-500/20 text-amber-500" :
                    selectedPair?.damageLevel === "major-damage" ? "bg-orange-500/20 text-orange-500" :
                    selectedPair?.damageLevel === "destroyed" ? "bg-destructive/20 text-destructive" :
                    "bg-secondary text-secondary-foreground"
                  )}>
                    {selectedPair?.damageLevel.replace(/-/g, ' ')}
                  </div>
                </div>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
                  {/* PRE IMAGE */}
                  <div className="flex flex-col gap-3 h-full">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">PRE-DISASTER</Badge>
                      <span className="text-xs text-muted-foreground">Historical Baseline</span>
                    </div>
                    <div className="flex-1 relative bg-muted rounded-xl overflow-hidden border border-border shadow-inner min-h-[300px]">
                      {selectedPair?.preImage ? (
                        <img src={selectedPair.preImage} className="absolute inset-0 w-full h-full object-contain" alt="Pre" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">No image</div>
                      )}
                    </div>
                  </div>

                  {/* POST IMAGE */}
                  <div className="flex flex-col gap-3 h-full">
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">POST-DISASTER</Badge>
                      <span className="text-xs text-muted-foreground">Current Status</span>
                    </div>
                    <div className="flex-1 relative bg-muted rounded-xl overflow-hidden border border-border shadow-inner min-h-[300px]">
                      {selectedPair?.postImage ? (
                        <img src={selectedPair.postImage} className="absolute inset-0 w-full h-full object-contain" alt="Post" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">No image</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>

        </div>

        {/* RIGHT SIDE: Desktop Chat Sidebar */}
        {chatOpen && (
          <div className="w-[380px] border-l border-border shrink-0 hidden md:block bg-card">
            <ChatPanel />
          </div>
        )}
      </div>

      {/* Mobile Chat Overlay */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-background/80 backdrop-blur-sm">
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-[380px] bg-card border-l border-border shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold text-foreground tracking-tight">
                GeoView AI Assistant
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChatOpen(false)}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
            <div className="h-[calc(100%-53px)]">
              <ChatPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
