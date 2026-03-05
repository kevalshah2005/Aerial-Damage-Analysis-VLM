"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuthenticator } from "@aws-amplify/ui-react"
import { UploadCloud, Trash2, ChevronRight, Layers as LayersIcon, Map as MapIcon, Target, Square, Focus } from "lucide-react"
import dynamic from "next/dynamic"

import DashboardHeader from "@/components/dashboard-header"
import ChatPanel from "@/components/chat-panel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ImageryLayer } from "@/lib/types"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"

// Dynamically import MapView with SSR disabled to avoid "window is not defined" error from Leaflet
const MapView = dynamic(() => import("@/components/map-view"), { 
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-muted animate-pulse flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <MapIcon className="h-8 w-8 text-muted-foreground/50" />
        <span className="text-xs font-medium text-muted-foreground/50 uppercase tracking-widest">Initializing Map...</span>
      </div>
    </div>
  )
})

export default function Page() {
  const { authStatus } = useAuthenticator(context => [context.authStatus])
  const router = useRouter()
  const [chatOpen, setChatOpen] = useState(true)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [layers, setLayers] = useState<ImageryLayer[]>([])
  const prevUrlsRef = useRef<Set<string>>(new Set())

  // Clean up Blob URLs
  useEffect(() => {
    const currentUrls = new Set<string>()
    layers.forEach(l => { if (l.url) currentUrls.add(l.url) })
    Array.from(prevUrlsRef.current).filter(url => !currentUrls.has(url)).forEach(url => {
      try { if (url.startsWith('blob:')) URL.revokeObjectURL(url) } catch (e) {}
    })
    prevUrlsRef.current = currentUrls
  }, [layers])

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/auth')
  }, [authStatus, router])

  const parseBoundsFromJson = async (file: File): Promise<[[number, number], [number, number]] | null> => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const lngLats = data?.features?.lng_lat
      const xys = data?.features?.xy
      
      if (!lngLats || !xys || lngLats.length === 0 || xys.length === 0) return null

      const getPoints = (wkt: string) => {
        const match = wkt.match(/\(\((.*?)\)\)/)
        return match ? match[1].split(',').map(p => p.trim().split(' ').map(Number)) : []
      }

      let allGeo: [number, number][] = []
      let allPixel: [number, number][] = []

      lngLats.forEach((f: any, i: number) => {
        const gps = getPoints(f.wkt)
        const pxs = getPoints(xys[i].wkt)
        if (gps.length === pxs.length) {
          allGeo.push(...gps as [number, number][])
          allPixel.push(...pxs as [number, number][])
        }
      })

      if (allGeo.length < 3) return null

      const minLat = Math.min(...allGeo.map(p => p[1])), maxLat = Math.max(...allGeo.map(p => p[1]))
      const minLng = Math.min(...allGeo.map(p => p[0])), maxLng = Math.max(...allGeo.map(p => p[0]))
      const minX = Math.min(...allPixel.map(p => p[0])), maxX = Math.max(...allPixel.map(p => p[0]))
      const minY = Math.min(...allPixel.map(p => p[1])), maxY = Math.max(...allPixel.map(p => p[1]))

      const latSpan = maxLat - minLat
      const lngSpan = maxLng - minLng
      const ySpan = maxY - minY
      const xSpan = maxX - minX

      if (xSpan < 2 || ySpan < 2) return null 

      const degLngPerPix = lngSpan / xSpan
      const degLatPerPix = latSpan / ySpan 

      const imageTopLat = maxLat + (minY * degLatPerPix)
      const imageBottomLat = imageTopLat - (1024 * degLatPerPix)
      const imageLeftLng = minLng - (minX * degLngPerPix)
      const imageRightLng = imageLeftLng + (1024 * degLngPerPix)

      const bounds: [[number, number], [number, number]] = [
        [Math.min(imageTopLat, imageBottomLat), Math.min(imageLeftLng, imageRightLng)],
        [Math.max(imageTopLat, imageBottomLat), Math.max(imageLeftLng, imageRightLng)]
      ]

      if (isNaN(bounds[0][0]) || isNaN(bounds[0][1])) return null
      return bounds
    } catch (e) {
      console.error("Error parsing JSON bounds", e)
      return null
    }
  }

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const pngFiles = files.filter(f => f.name.toLowerCase().endsWith('.png'))
    const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith('.json'))

    const newLayers: ImageryLayer[] = []

    for (const png of pngFiles) {
      const fileName = png.name.toLowerCase()
      const baseName = fileName.replace(/\.(png|jpg|jpeg)$/i, '')
      const isPost = fileName.includes('post_disaster')
      const type = isPost ? 'post' : 'pre'
      
      const jsonMatch = jsonFiles.find(j => j.name.toLowerCase().replace('.json', '') === baseName)
      let bounds: [[number, number], [number, number]] | undefined = undefined
      
      if (jsonMatch) {
        const parsedBounds = await parseBoundsFromJson(jsonMatch)
        if (parsedBounds) bounds = parsedBounds
      }

      const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1).replace(/(_|-)/g, ' ')
      
      let simulatedDamage: string | undefined = undefined
      if (type === 'post') {
        const levels = ["no-damage", "minor-damage", "major-damage", "destroyed"]
        simulatedDamage = levels[Math.floor(Math.random() * levels.length)]
      }

      newLayers.push({
        id: Math.random().toString(36).substr(2, 9),
        name: displayName,
        url: URL.createObjectURL(png),
        type,
        visible: true,
        opacity: 1,
        bounds,
        highlighted: false,
        damageLevel: simulatedDamage
      })
    }

    if (newLayers.length > 0) {
      setLayers(prev => [...prev, ...newLayers])
      toast.success(`Successfully loaded ${newLayers.length} imagery layers`)
    } else {
      toast.error("No valid imagery files found. Ensure you select PNG files.")
    }
  }

  const toggleLayer = useCallback((id: string) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l))
  }, [])

  const toggleHighlight = (id: string) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, highlighted: !l.highlighted } : l))
  }

  const toggleAllHighlights = () => {
    setLayers(prev => {
      const anyHighlighted = prev.some(l => l.highlighted)
      return prev.map(l => ({ ...l, highlighted: !anyHighlighted }))
    })
  }

  const toggleAllByType = (type: 'pre' | 'post') => {
    setLayers(prev => {
      const anyVisible = prev.filter(l => l.type === type).some(l => l.visible)
      return prev.map(l => l.type === type ? { ...l, visible: !anyVisible } : l)
    })
  }

  const removeLayer = (id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id))
  }

  if (authStatus === 'configuring' || authStatus === 'unauthenticated') {
    return <div className="flex h-screen items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <DashboardHeader 
        chatOpen={chatOpen} 
        onToggleChat={() => setChatOpen(!chatOpen)}
        leftPanelOpen={leftPanelOpen}
        onToggleLeftPanel={() => setLeftPanelOpen(!leftPanelOpen)}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* SIDEBAR: Layer Management */}
        {leftPanelOpen && (
          <div className="w-96 border-r border-border bg-card/50 hidden lg:flex flex-col shrink-0 overflow-hidden relative z-20">
            <div className="p-4 border-b border-border flex items-center justify-between bg-card">
              <div className="flex items-center gap-2 font-bold text-sm tracking-tight">
                <LayersIcon className="h-4 w-4 text-primary" />
                <span>Layer Manager</span>
              </div>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold">{layers.length}</Badge>
            </div>

            {/* Master Toggles */}
            {layers.length > 0 && (
              <div className="px-4 py-3 bg-muted/20 border-b border-border space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center justify-between">
                  <span>Master Controls</span>
                  <button 
                    onClick={toggleAllHighlights}
                    className="text-[9px] hover:text-primary transition-colors flex items-center gap-1 font-bold"
                  >
                    <Square className={cn("h-2.5 w-2.5", layers.some(l => l.highlighted) && "fill-primary text-primary")} />
                    {layers.some(l => l.highlighted) ? "Unhighlight All" : "Highlight All"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className={cn(
                      "h-8 text-[10px] font-black uppercase tracking-tighter transition-all",
                      layers.filter(l => l.type === 'pre').some(l => l.visible) ? "bg-secondary/50 border-secondary-foreground/20" : "opacity-50"
                    )}
                    onClick={() => toggleAllByType('pre')}
                  >
                    {layers.filter(l => l.type === 'pre').some(l => l.visible) ? "Hide All Pre" : "Show All Pre"}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className={cn(
                      "h-8 text-[10px] font-black uppercase tracking-tighter transition-all",
                      layers.filter(l => l.type === 'post').some(l => l.visible) ? "bg-destructive/10 border-destructive/20 text-destructive" : "opacity-50"
                    )}
                    onClick={() => toggleAllByType('post')}
                  >
                    {layers.filter(l => l.type === 'post').some(l => l.visible) ? "Hide All Post" : "Show All Post"}
                  </Button>
                </div>
              </div>
            )}
            
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {layers.length > 0 ? (
                  layers.map((layer) => (
                    <div key={layer.id} className={cn("group p-3 rounded-xl border transition-all duration-200", layer.visible ? "bg-card border-primary/20 shadow-sm" : "bg-muted/30 border-transparent opacity-60 hover:opacity-100")}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold truncate tracking-tight">{layer.name}</span>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Badge variant={layer.type === 'pre' ? "secondary" : "destructive"} className="text-[9px] h-4 px-1 uppercase font-black tracking-tighter">{layer.type}</Badge>
                            {layer.damageLevel && <span className={cn("text-[10px] font-bold truncate", layer.damageLevel === "no-damage" ? "text-emerald-500" : layer.damageLevel === "minor-damage" ? "text-amber-500" : layer.damageLevel === "major-damage" ? "text-orange-500" : "text-destructive")}>• {layer.damageLevel.replace(/-/g, ' ')}</span>}
                          </div>
                          {!layer.bounds && <span className="text-[9px] text-amber-500 font-bold mt-1 uppercase tracking-tighter">⚠️ Missing Geo-Metadata</span>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleHighlight(layer.id)}
                            className={cn("h-7 w-7 transition-colors", layer.highlighted ? "text-primary hover:bg-primary/20" : "text-muted-foreground hover:bg-muted")}
                            title="Highlight on map"
                          >
                            <Square className={cn("h-3.5 w-3.5", layer.highlighted && "fill-primary")} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => toggleLayer(layer.id)} className="h-7 w-7 hover:bg-primary/10 hover:text-primary">{layer.visible ? <LayersIcon className="h-3.5 w-3.5" /> : <LayersIcon className="h-3.5 w-3.5 opacity-40" />}</Button>
                          <Button variant="ghost" size="icon" onClick={() => removeLayer(layer.id)} className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-border rounded-2xl bg-muted/20">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-3"><UploadCloud className="h-5 w-5 text-primary/60" /></div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">No Layers Active</p>
                    <p className="text-[11px] text-muted-foreground/60 leading-relaxed">Upload PNG + JSON imagery to begin analysis.</p>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="p-4 border-t border-border bg-card">
              <input type="file" multiple ref={fileInputRef} onChange={handleBulkUpload} className="hidden" accept=".png,.json" />
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => fileInputRef.current?.click()} className="h-9 gap-2 font-bold text-xs"><UploadCloud className="h-4 w-4" /><span>Upload</span></Button>
                <Button onClick={() => setLayers([])} variant="outline" className="h-9 gap-2 text-muted-foreground hover:text-destructive transition-all text-xs font-bold"><Trash2 className="h-4 w-4" /><span>Clear</span></Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 h-full relative">
          <MapView layers={layers} onToggleLayer={toggleLayer} />
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] hidden sm:flex">
             <div className="px-4 py-1.5 rounded-full bg-card/80 backdrop-blur-md border border-border shadow-2xl flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-foreground">Mission Active</span>
                </div>
                <Separator orientation="vertical" className="h-3" />
                <span className="text-[10px] font-bold text-muted-foreground italic">{layers.filter(l => l.visible).length} layers deployed</span>
             </div>
          </div>
        </div>

        {chatOpen && <div className="w-[400px] border-l border-border shrink-0 hidden md:block bg-card/50 backdrop-blur-md relative z-10 shadow-2xl"><ChatPanel /></div>}
      </div>
    </div>
  )
}
