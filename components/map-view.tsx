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

interface MapLocation {
  name: string
  lat: number
  lng: number
  zoom: number
}

const PRESET_LOCATIONS: MapLocation[] = [
  { name: "New York City", lat: 40.7128, lng: -74.006, zoom: 14 },
  { name: "San Francisco", lat: 37.7749, lng: -122.4194, zoom: 14 },
  { name: "UT Dallas", lat: 32.9857, lng: -96.7503, zoom: 16 },
  { name: "Grand Canyon", lat: 36.1069, lng: -112.1129, zoom: 13 },
  { name: "Mount Fuji", lat: 35.3606, lng: 138.7274, zoom: 13 },
  { name: "Amazon Basin", lat: -3.4653, lng: -62.2159, zoom: 10 },
]

const TILE_LAYERS = [
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

export default function MapView({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const [activeLayer, setActiveLayer] = useState(0)
  const [showLayerPicker, setShowLayerPicker] = useState(false)
  const [coordinates, setCoordinates] = useState({ lat: 40.7128, lng: -74.006 })
  const [zoom, setZoom] = useState(14)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    let cancelled = false

    async function initMap() {
      const map = L.map(mapRef.current, {
        center: [40.7128, -74.006],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
      })

      const tileLayer = L.tileLayer(TILE_LAYERS[0].url, {
        maxZoom: 19,
      }).addTo(map)

      tileLayerRef.current = tileLayer
      mapInstanceRef.current = map

      map.on("moveend", () => {
        const center = map.getCenter()
        setCoordinates({ lat: center.lat, lng: center.lng })
        setZoom(map.getZoom())
      })

      map.on("zoomend", () => {
        setZoom(map.getZoom())
      })
    }

    initMap()

    return () => {
      cancelled = true
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  // Invalidate map size when container resizes (e.g. chat panel toggle)
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

  const switchLayer = useCallback(
    (index: number) => {
      if (!mapInstanceRef.current || !tileLayerRef.current) return
      mapInstanceRef.current.removeLayer(tileLayerRef.current)
      const newLayer = L.tileLayer(TILE_LAYERS[index].url, {
        maxZoom: 19,
      }).addTo(mapInstanceRef.current)
      tileLayerRef.current = newLayer
      setActiveLayer(index)
      setShowLayerPicker(false)
    },
    []
  )

  const handleZoomIn = useCallback(() => {
    mapInstanceRef.current?.zoomIn()
  }, [])

  const handleZoomOut = useCallback(() => {
    mapInstanceRef.current?.zoomOut()
  }, [])

  const flyTo = useCallback((location: MapLocation) => {
    mapInstanceRef.current?.flyTo([location.lat, location.lng], location.zoom, {
      duration: 1.5,
    })
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!mapRef.current) return
    if (!document.fullscreenElement) {
      mapRef.current.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative h-full w-full flex flex-col">
      {/* Location presets */}
      <div className="flex items-center gap-2 px-4 py-2 bg-card border-b border-border overflow-x-auto">
        <span className="text-xs font-medium text-muted-foreground shrink-0">
          Locations:
        </span>
        {PRESET_LOCATIONS.map((loc) => (
          <button
            key={loc.name}
            onClick={() => flyTo(loc)}
            className="px-3 py-1 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-colors whitespace-nowrap"
          >
            {loc.name}
          </button>
        ))}
      </div>

      {/* Map container */}
      <div className="relative flex-1">
        <div ref={mapRef} className="h-full w-full" />

        {/* Map controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 z-[1000]">
          <Button
            variant="secondary"
            size="icon"
            onClick={handleZoomIn}
            className="h-9 w-9 bg-card/90 backdrop-blur-sm border border-border hover:bg-secondary"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={handleZoomOut}
            className="h-9 w-9 bg-card/90 backdrop-blur-sm border border-border hover:bg-secondary"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={toggleFullscreen}
            className="h-9 w-9 bg-card/90 backdrop-blur-sm border border-border hover:bg-secondary"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <div className="relative">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setShowLayerPicker(!showLayerPicker)}
              className="h-9 w-9 bg-card/90 backdrop-blur-sm border border-border hover:bg-secondary"
              aria-label="Switch layers"
            >
              <Layers className="h-4 w-4" />
            </Button>
            {showLayerPicker && (
              <div className="absolute right-10 top-0 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-2 min-w-[140px]">
                {TILE_LAYERS.map((layer, i) => (
                  <button
                    key={layer.name}
                    onClick={() => switchLayer(i)}
                    className={`w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors ${
                      i === activeLayer
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    {layer.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Coordinates overlay */}
        <div className="absolute bottom-4 left-4 flex items-center gap-3 z-[1000] bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2">
          <Crosshair className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-mono text-foreground">
            {coordinates.lat.toFixed(4)}, {coordinates.lng.toFixed(4)}
          </span>
          <span className="text-xs text-muted-foreground">
            Zoom: {zoom}
          </span>
        </div>

        {/* Attribution */}
        <div className="absolute bottom-4 right-4 z-[1000]">
          <span className="text-[10px] text-muted-foreground bg-card/70 backdrop-blur-sm px-2 py-1 rounded">
            {TILE_LAYERS[activeLayer].attribution}
          </span>
        </div>
      </div>
    </div>
  )
}
