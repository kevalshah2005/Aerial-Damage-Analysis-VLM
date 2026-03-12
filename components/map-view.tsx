"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import {
  Layers,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Maximize2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { cn } from "@/lib/utils"
import { ImageryLayer } from "@/lib/types"

interface MapLocation {
  name: string
  lat: number
  lng: number
  zoom: number
}

const BASE_LAYERS = [
  {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, Maxar, Earthstar Geographics",
  },
  {
    name: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "OpenTopoMap",
  },
  {
    name: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "CartoDB",
  },
]

interface MapViewProps {
  className?: string
  layers?: ImageryLayer[]
  onToggleLayer?: (id: string) => void
}

export default function MapView({ className, layers = [] }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const baseLayerRef = useRef<L.TileLayer | null>(null)
  const imageryLayersRef = useRef<Record<string, L.ImageOverlay>>({})
  const geometryLayersRef = useRef<Record<string, L.LayerGroup>>({})
  const highlightRefs = useRef<Record<string, L.Rectangle>>({})
  
  const [activeBaseLayer, setActiveBaseLayer] = useState(2)
  const [showLayerPicker, setShowLayerPicker] = useState(false)
  const [coordinates, setCoordinates] = useState({ lat: 29.7604, lng: -95.3698 })
  const [zoom, setZoom] = useState(12)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = L.map(mapRef.current, {
      center: [29.7604, -95.3698],
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    })

    const tileLayer = L.tileLayer(BASE_LAYERS[2].url, {
      maxZoom: 19,
    }).addTo(map)

    baseLayerRef.current = tileLayer
    mapInstanceRef.current = map

    map.on("moveend", () => {
      const center = map.getCenter()
      setCoordinates({ lat: center.lat, lng: center.lng })
      setZoom(map.getZoom())
    })

    map.on("zoomend", () => {
      setZoom(map.getZoom())
    })

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  // Sync Imagery Layers
  useEffect(() => {
    if (!mapInstanceRef.current) return

    const map = mapInstanceRef.current
    const currentRefs = imageryLayersRef.current
    const currentGeometries = geometryLayersRef.current
    const currentHighlights = highlightRefs.current

    // Remove layers and highlights that are no longer in the props or are hidden
    const cleanup = (id: string) => {
      const layerData = layers.find(l => l.id === id)
      if (!layerData || !layerData.visible || !layerData.bounds) {
        if (currentRefs[id]) {
          map.removeLayer(currentRefs[id])
          delete currentRefs[id]
        }
        
        if (currentGeometries[id]) {
          map.removeLayer(currentGeometries[id])
          delete currentGeometries[id]
        }

        if (currentHighlights[id]) {
          map.removeLayer(currentHighlights[id])
          delete currentHighlights[id]
        }
      }
    }

    Object.keys(currentRefs).forEach(cleanup)
    Object.keys(currentGeometries).forEach(cleanup)


    // Add or update layers from props
    layers.forEach(layer => {
      if (layer.bounds) {
        // Image Overlay sync
        if (layer.visible && layer.url) {
          if (!currentRefs[layer.id]) {
            const overlay = L.imageOverlay(layer.url, layer.bounds, {
              opacity: layer.opacity,
              interactive: true,
              zIndex: layer.type === 'post' ? 1000 : 900,
              alt: layer.name
            }).addTo(map)
            currentRefs[layer.id] = overlay

            if (Object.keys(currentRefs).length === 1 || layers.length === Object.keys(currentRefs).length) {
              map.fitBounds(layer.bounds, { padding: [50, 50], maxZoom: 18 })
            }
          } else {
            currentRefs[layer.id].setOpacity(layer.opacity)
          }
        } else if (currentRefs[layer.id]) {
          map.removeLayer(currentRefs[layer.id])
          delete currentRefs[layer.id]
        }

        // Geometry sync
        if (layer.visible && layer.geometries && layer.geometries.length > 0) {
          if (!currentGeometries[layer.id]) {
            const geoGroup = L.layerGroup().addTo(map)
            
            layer.geometries.forEach(geo => {
              if (geo.type === 'Polygon') {
                const subtype = geo.properties?.subtype || 'unknown'
                const color = 
                  subtype === 'no-damage' ? '#22c55e' : // Green
                  subtype === 'minor-damage' ? '#f59e0b' : // Amber/Orange
                  subtype === 'major-damage' ? '#ef4444' : // Red
                  subtype === 'destroyed' ? '#7c3aed' : // Purple
                  '#94a3b8' // Slate/Grey

                L.polygon(geo.coordinates as L.LatLngExpression[], {
                  color: color,
                  weight: 1.5,
                  fillColor: color,
                  fillOpacity: layer.opacity * 0.5,
                  opacity: layer.opacity,
                  interactive: true,
                  pane: 'markerPane'
                })
                .bindPopup(`Building ID: ${geo.properties?.uid}<br>Damage: ${subtype.replace(/-/g, ' ')}`)
                .addTo(geoGroup)
              }
            })
            
            currentGeometries[layer.id] = geoGroup
          } else {
            // Update opacity for existing geometries
            currentGeometries[layer.id].eachLayer((l: any) => {
              if (l.setStyle) {
                l.setStyle({ 
                  fillOpacity: layer.opacity * 0.5,
                  opacity: layer.opacity 
                })
              }
            })
          }
        } else if (currentGeometries[layer.id]) {
          map.removeLayer(currentGeometries[layer.id])
          delete currentGeometries[layer.id]
        }

        // Highlight sync
        if (layer.visible && layer.highlighted && !currentHighlights[layer.id]) {
          const rect = L.rectangle(layer.bounds, {
            color: "#ef4444", 
            weight: 2,
            fill: false,
            dashArray: "5, 5",
            interactive: false,
          }).addTo(map)
          rect.bringToFront()
          currentHighlights[layer.id] = rect
        } else if (!layer.highlighted && currentHighlights[layer.id]) {
          map.removeLayer(currentHighlights[layer.id])
          delete currentHighlights[layer.id]
        }
      }
    })
  }, [layers])

  // Invalidate map size
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      setTimeout(() => {
        mapInstanceRef.current?.invalidateSize()
      }, 50)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const switchBaseLayer = useCallback((index: number) => {
    if (!mapInstanceRef.current || !baseLayerRef.current) return
    mapInstanceRef.current.removeLayer(baseLayerRef.current)
    const newLayer = L.tileLayer(BASE_LAYERS[index].url, {
      maxZoom: 19,
    }).addTo(mapInstanceRef.current)
    baseLayerRef.current = newLayer
    setActiveBaseLayer(index)
    setShowLayerPicker(false)
  }, [])

  const handleZoomIn = useCallback(() => mapInstanceRef.current?.zoomIn(), [])
  const handleZoomOut = useCallback(() => mapInstanceRef.current?.zoomOut(), [])

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }, [])

  return (
    <div ref={containerRef} className={cn("relative h-full w-full flex flex-col overflow-hidden", className)}>
      {/* Map container */}
      <div className="relative flex-1 min-h-0">
        <div ref={mapRef} className="h-full w-full z-0" />

        {/* Map controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 z-[1000]">
          <div className="flex flex-col bg-card/90 backdrop-blur-sm border border-border rounded-lg overflow-hidden shadow-lg">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              className="h-9 w-9 rounded-none border-b border-border hover:bg-secondary"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              className="h-9 w-9 rounded-none hover:bg-secondary"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="secondary"
            size="icon"
            onClick={toggleFullscreen}
            className="h-9 w-9 bg-card/90 backdrop-blur-sm border border-border hover:bg-secondary shadow-lg"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>

          <div className="relative">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setShowLayerPicker(!showLayerPicker)}
              className={cn(
                "h-9 w-9 bg-card/90 backdrop-blur-sm border border-border hover:bg-secondary shadow-lg",
                showLayerPicker && "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              <Layers className="h-4 w-4" />
            </Button>
            
            {showLayerPicker && (
              <div className="absolute right-11 top-0 bg-card/95 backdrop-blur-md border border-border rounded-lg p-2 min-w-[160px] shadow-2xl animate-in fade-in slide-in-from-right-2 duration-200">
                <div className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground px-2 mb-1.5 border-b border-border/50 pb-1">Base Maps</div>
                <div className="py-1">
                  {BASE_LAYERS.map((layer, i) => (
                    <button
                      key={layer.name}
                      onClick={() => switchBaseLayer(i)}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-[11px] rounded-md transition-all mb-0.5",
                        i === activeBaseLayer
                          ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                          : "text-foreground hover:bg-secondary"
                      )}
                    >
                      {layer.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Coordinates overlay */}
        <div className="absolute bottom-6 left-6 flex items-center gap-3 z-[1000] bg-card/90 backdrop-blur-md border border-border rounded-full px-4 py-2 shadow-xl border-primary/20">
          <Crosshair className="h-3.5 w-3.5 text-primary animate-pulse" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter leading-none mb-0.5">Location</span>
            <span className="text-xs font-mono font-bold text-foreground tabular-nums">
              {coordinates.lat.toFixed(5)}°N, {coordinates.lng.toFixed(5)}°W
            </span>
          </div>
          <div className="h-6 w-px bg-border mx-1" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter leading-none mb-0.5">Zoom</span>
            <span className="text-xs font-mono font-bold text-foreground tabular-nums">
              {zoom.toFixed(1)}
            </span>
          </div>
        </div>

        {/* Attribution */}
        <div className="absolute bottom-2 right-2 z-[1000]">
          <span className="text-[8px] text-muted-foreground/60 bg-card/30 backdrop-blur-[2px] px-2 py-0.5 rounded italic">
            {BASE_LAYERS[activeBaseLayer].attribution}
          </span>
        </div>
      </div>
    </div>
  )
}
