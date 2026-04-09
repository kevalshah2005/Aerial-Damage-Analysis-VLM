"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import {
  Layers,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Maximize2,
  Satellite,
  Eye,
  Building2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { cn } from "@/lib/utils"
import { DatasetManifest, DatasetPatch } from "@/lib/types"

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
  manifest?: DatasetManifest | null
  datasetPreVisible?: boolean
  datasetPostVisible?: boolean
  datasetBuildingsVisible?: boolean
  datasetPreOpacity?: number
  datasetPostOpacity?: number
  datasetBuildingsOpacity?: number
  onToggleDatasetPre?: () => void
  onToggleDatasetPost?: () => void
  onToggleDatasetBuildings?: () => void
  onSetDatasetPreOpacity?: (v: number) => void
  onSetDatasetPostOpacity?: (v: number) => void
  onSetDatasetBuildingsOpacity?: (v: number) => void
}

function boundsOverlap(
  a: L.LatLngBounds,
  b: [[number, number], [number, number]]
): boolean {
  const bb = L.latLngBounds(b)
  return a.intersects(bb)
}

function parseBuildingGeometries(data: any): { type: string; coordinates: L.LatLngExpression[]; properties: any }[] {
  const features = data?.features?.lng_lat
  if (!features || !Array.isArray(features)) return []

  const getPoints = (wkt: string): [number, number][] => {
    const match = wkt.match(/\(\((.*?)\)\)/)
    return match
      ? match[1].split(",").map((p) => {
          const parts = p.trim().split(" ").map(Number)
          return [parts[0], parts[1]] as [number, number]
        })
      : []
  }

  return features.map((f: any) => {
    const gps = getPoints(f.wkt)
    const coordinates = gps.map((p) => [p[1], p[0]])
    return {
      type: "Polygon",
      coordinates: coordinates as L.LatLngExpression[],
      properties: f.properties,
    }
  })
}

export default function MapView({
  className,
  manifest = null,
  datasetPreVisible = false,
  datasetPostVisible = false,
  datasetBuildingsVisible = false,
  datasetPreOpacity = 1,
  datasetPostOpacity = 1,
  datasetBuildingsOpacity = 1,
  onToggleDatasetPre,
  onToggleDatasetPost,
  onToggleDatasetBuildings,
  onSetDatasetPreOpacity,
  onSetDatasetPostOpacity,
  onSetDatasetBuildingsOpacity,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const baseLayerRef = useRef<L.TileLayer | null>(null)

  const preOverlaysRef = useRef<Record<string, L.ImageOverlay>>({})
  const postOverlaysRef = useRef<Record<string, L.ImageOverlay>>({})
  const buildingOverlaysRef = useRef<Record<string, L.LayerGroup>>({})
  const buildingCacheRef = useRef<Record<string, any>>({})
  const loadedPreRef = useRef<Set<string>>(new Set())
  const loadedPostRef = useRef<Set<string>>(new Set())
  const loadedBuildingsRef = useRef<Set<string>>(new Set())
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [activeBaseLayer, setActiveBaseLayer] = useState(2)
  const [showLayerPicker, setShowLayerPicker] = useState(false)
  const [coordinates, setCoordinates] = useState({ lat: 29.7604, lng: -95.3698 })
  const [zoom, setZoom] = useState(12)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [visiblePatchCount, setVisiblePatchCount] = useState(0)

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

  const getVisiblePatches = useCallback((): DatasetPatch[] => {
    if (!manifest || !mapInstanceRef.current) return []
    const bounds = mapInstanceRef.current.getBounds()
    return manifest.patches.filter((p) => boundsOverlap(bounds, p.bounds))
  }, [manifest])

  // Dataset: Pre-disaster imagery overlays
  useEffect(() => {
    if (!mapInstanceRef.current || !manifest) return
    const map = mapInstanceRef.current

    if (!datasetPreVisible) {
      Object.values(preOverlaysRef.current).forEach((o) => map.removeLayer(o))
      preOverlaysRef.current = {}
      loadedPreRef.current.clear()
      return
    }

    const visible = getVisiblePatches()
    const visibleIds = new Set(visible.map((p) => p.id))

    for (const id of loadedPreRef.current) {
      if (!visibleIds.has(id) && preOverlaysRef.current[id]) {
        map.removeLayer(preOverlaysRef.current[id])
        delete preOverlaysRef.current[id]
        loadedPreRef.current.delete(id)
      }
    }

    for (const patch of visible) {
      if (!loadedPreRef.current.has(patch.id)) {
        const url = patch.pre
        const overlay = L.imageOverlay(url, patch.bounds, {
          opacity: datasetPreOpacity,
          zIndex: 900,
          alt: patch.pre,
        }).addTo(map)
        preOverlaysRef.current[patch.id] = overlay
        loadedPreRef.current.add(patch.id)
      }
    }

    setVisiblePatchCount(visible.length)
  }, [manifest, datasetPreVisible, getVisiblePatches])

  useEffect(() => {
    Object.values(preOverlaysRef.current).forEach((o) => o.setOpacity(datasetPreOpacity))
  }, [datasetPreOpacity])

  // Dataset: Post-disaster imagery overlays
  useEffect(() => {
    if (!mapInstanceRef.current || !manifest) return
    const map = mapInstanceRef.current

    if (!datasetPostVisible) {
      Object.values(postOverlaysRef.current).forEach((o) => map.removeLayer(o))
      postOverlaysRef.current = {}
      loadedPostRef.current.clear()
      return
    }

    const visible = getVisiblePatches()
    const visibleIds = new Set(visible.map((p) => p.id))

    for (const id of loadedPostRef.current) {
      if (!visibleIds.has(id) && postOverlaysRef.current[id]) {
        map.removeLayer(postOverlaysRef.current[id])
        delete postOverlaysRef.current[id]
        loadedPostRef.current.delete(id)
      }
    }

    for (const patch of visible) {
      if (!loadedPostRef.current.has(patch.id)) {
        const url = patch.post
        const overlay = L.imageOverlay(url, patch.bounds, {
          opacity: datasetPostOpacity,
          zIndex: 1000,
          alt: patch.post,
        }).addTo(map)
        postOverlaysRef.current[patch.id] = overlay
        loadedPostRef.current.add(patch.id)
      }
    }

    setVisiblePatchCount(visible.length)
  }, [manifest, datasetPostVisible, getVisiblePatches])

  useEffect(() => {
    Object.values(postOverlaysRef.current).forEach((o) => o.setOpacity(datasetPostOpacity))
  }, [datasetPostOpacity])

  // Dataset: Building polygon overlays
  useEffect(() => {
    if (!mapInstanceRef.current || !manifest) return
    const map = mapInstanceRef.current

    if (!datasetBuildingsVisible) {
      Object.values(buildingOverlaysRef.current).forEach((g) => map.removeLayer(g))
      buildingOverlaysRef.current = {}
      loadedBuildingsRef.current.clear()
      return
    }

    const visible = getVisiblePatches()
    const visibleIds = new Set(visible.map((p) => p.id))

    for (const id of loadedBuildingsRef.current) {
      if (!visibleIds.has(id) && buildingOverlaysRef.current[id]) {
        map.removeLayer(buildingOverlaysRef.current[id])
        delete buildingOverlaysRef.current[id]
        loadedBuildingsRef.current.delete(id)
      }
    }

    for (const patch of visible) {
      if (!loadedBuildingsRef.current.has(patch.id)) {
        loadedBuildingsRef.current.add(patch.id)

        const loadBuildings = async () => {
          try {
            let data = buildingCacheRef.current[patch.id]
            if (!data) {
              const res = await fetch(patch.postJson)
              if (!res.ok) return
              data = await res.json()
              buildingCacheRef.current[patch.id] = data
            }

            const geometries = parseBuildingGeometries(data)
            if (geometries.length === 0) return

            const geoGroup = L.layerGroup()
            geometries.forEach((geo) => {
              const subtype = (geo.properties?.subtype || "unknown").trim().toLowerCase()
              console.log("Building subtype:", subtype, "full props:", geo.properties)
              const color =
                subtype === "no-damage"
                  ? "#22c55e"
                  : subtype === "minor-damage"
                    ? "#f59e0b"
                    : subtype === "major-damage"
                      ? "#ef4444"
                      : subtype === "destroyed"
                        ? "#7c3aed"
                        : "#94a3b8"

              L.polygon(geo.coordinates, {
                color,
                weight: 1.5,
                fillColor: color,
                fillOpacity: datasetBuildingsOpacity * 0.5,
                opacity: datasetBuildingsOpacity,
                interactive: true,
                pane: "markerPane",
              })
                .bindPopup(
                  `Building: ${geo.properties?.uid?.substring(0, 8)}...<br>Damage: ${subtype.replace(/-/g, " ")} (raw: ${geo.properties?.subtype})`
                )
                .addTo(geoGroup)
            })

            geoGroup.addTo(map)
            buildingOverlaysRef.current[patch.id] = geoGroup
          } catch {
            // Silently skip failed patches
          }
        }

        loadBuildings()
      }
    }
  }, [manifest, datasetBuildingsVisible, getVisiblePatches])

  useEffect(() => {
    Object.values(buildingOverlaysRef.current).forEach((group) => {
      group.eachLayer((l: any) => {
        if (l.setStyle) {
          l.setStyle({ fillOpacity: datasetBuildingsOpacity * 0.5, opacity: datasetBuildingsOpacity })
        }
      })
    })
  }, [datasetBuildingsOpacity])

  // Re-trigger dataset loading on map move
  const handleMapMove = useCallback(() => {
    if (!manifest || !mapInstanceRef.current) return

    const visible = getVisiblePatches()
    setVisiblePatchCount(visible.length)

    const map = mapInstanceRef.current

    if (datasetPreVisible) {
      const visibleIds = new Set(visible.map((p) => p.id))
      // Only add new overlays, don't remove - just toggle visibility
      for (const patch of visible) {
        if (!loadedPreRef.current.has(patch.id)) {
          const url = patch.pre
          const overlay = L.imageOverlay(url, patch.bounds, { opacity: datasetPreOpacity, zIndex: 900, alt: patch.pre }).addTo(map)
          preOverlaysRef.current[patch.id] = overlay
          loadedPreRef.current.add(patch.id)
        }
      }
      // Hide off-screen patches instead of removing
      for (const id of loadedPreRef.current) {
        if (!visibleIds.has(id) && preOverlaysRef.current[id]) {
          map.removeLayer(preOverlaysRef.current[id])
        }
      }
    }

    if (datasetPostVisible) {
      const visibleIds = new Set(visible.map((p) => p.id))
      // Add new overlays, hide off-screen
      for (const patch of visible) {
        if (!loadedPostRef.current.has(patch.id)) {
          const url = patch.post
          const overlay = L.imageOverlay(url, patch.bounds, { opacity: datasetPostOpacity, zIndex: 1000, alt: patch.post }).addTo(map)
          postOverlaysRef.current[patch.id] = overlay
          loadedPostRef.current.add(patch.id)
        }
      }
      for (const id of loadedPostRef.current) {
        if (!visibleIds.has(id) && postOverlaysRef.current[id]) {
          map.removeLayer(postOverlaysRef.current[id])
        }
      }
    }

    if (datasetBuildingsVisible) {
      const visibleIds = new Set(visible.map((p) => p.id))
      // Add new buildings, hide off-screen
      for (const patch of visible) {
        if (!loadedBuildingsRef.current.has(patch.id)) {
          loadedBuildingsRef.current.add(patch.id)
          const loadBuildings = async () => {
            try {
              let data = buildingCacheRef.current[patch.id]
              if (!data) {
                const res = await fetch(patch.postJson)
                if (!res.ok) return
                data = await res.json()
                buildingCacheRef.current[patch.id] = data
              }
              const geometries = parseBuildingGeometries(data)
              if (geometries.length === 0) return
              const geoGroup = L.layerGroup()
              geometries.forEach((geo) => {
                const subtype = (geo.properties?.subtype || "unknown").trim().toLowerCase()
                const color = subtype === "no-damage" ? "#22c55e" : subtype === "minor-damage" ? "#f59e0b" : subtype === "major-damage" ? "#ef4444" : subtype === "destroyed" ? "#7c3aed" : "#94a3b8"
                L.polygon(geo.coordinates, { color, weight: 1.5, fillColor: color, fillOpacity: datasetBuildingsOpacity * 0.5, opacity: datasetBuildingsOpacity, interactive: true, pane: "markerPane" })
                  .bindPopup(`Building: ${geo.properties?.uid?.substring(0, 8)}...<br>Damage: ${subtype.replace(/-/g, " ")} (raw: ${geo.properties?.subtype})`)
                  .addTo(geoGroup)
              })
              geoGroup.addTo(map)
              buildingOverlaysRef.current[patch.id] = geoGroup
            } catch {}
          }
          loadBuildings()
        }
      }
    }
  }, [manifest, datasetPreVisible, datasetPostVisible, datasetBuildingsVisible, datasetPreOpacity, datasetPostOpacity, datasetBuildingsOpacity, getVisiblePatches])

  // Debounced map move handler for better performance
  const debouncedHandleMapMove = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      handleMapMove()
    }, 150) // 150ms debounce
  }, [handleMapMove])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    map.on("moveend", debouncedHandleMapMove)
    return () => {
      map.off("moveend", debouncedHandleMapMove)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [debouncedHandleMapMove])

  // Fit to total bounds when manifest loads
  useEffect(() => {
    if (manifest && mapInstanceRef.current) {
      mapInstanceRef.current.fitBounds(manifest.totalBounds, { padding: [50, 50], maxZoom: 15 })
    }
  }, [manifest])

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

  const hasDataset = !!manifest

  return (
    <div ref={containerRef} className={cn("relative h-full w-full flex flex-col overflow-hidden", className)}>
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
            <Button variant="ghost" size="icon" onClick={handleZoomOut} className="h-9 w-9 rounded-none hover:bg-secondary">
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
              <div className="absolute right-11 top-0 bg-card/95 backdrop-blur-md border border-border rounded-lg p-2 min-w-[200px] shadow-2xl animate-in fade-in slide-in-from-right-2 duration-200">
                <div className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground px-2 mb-1.5 border-b border-border/50 pb-1">
                  Base Maps
                </div>
                <div className="py-1 mb-2">
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

                {hasDataset && (
                  <>
                    <div className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground px-2 mb-1.5 border-b border-border/50 pb-1">
                      Dataset Overlays
                    </div>
                    <div className="py-1 space-y-1">
                      <button
                        onClick={onToggleDatasetPre}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-[11px] rounded-md transition-all flex items-center gap-2",
                          datasetPreVisible
                            ? "bg-secondary font-semibold"
                            : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <Satellite className="h-3 w-3" />
                        Pre-Disaster
                        <Eye className={cn("h-3 w-3 ml-auto", datasetPreVisible ? "opacity-100" : "opacity-30")} />
                      </button>
                      {datasetPreVisible && onSetDatasetPreOpacity && (
                        <div className="px-3 py-1">
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={datasetPreOpacity}
                            onChange={(e) => onSetDatasetPreOpacity(parseFloat(e.target.value))}
                            className="w-full h-1 accent-primary"
                          />
                        </div>
                      )}

                      <button
                        onClick={onToggleDatasetPost}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-[11px] rounded-md transition-all flex items-center gap-2",
                          datasetPostVisible
                            ? "bg-secondary font-semibold"
                            : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <Satellite className="h-3 w-3" />
                        Post-Disaster
                        <Eye className={cn("h-3 w-3 ml-auto", datasetPostVisible ? "opacity-100" : "opacity-30")} />
                      </button>
                      {datasetPostVisible && onSetDatasetPostOpacity && (
                        <div className="px-3 py-1">
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={datasetPostOpacity}
                            onChange={(e) => onSetDatasetPostOpacity(parseFloat(e.target.value))}
                            className="w-full h-1 accent-primary"
                          />
                        </div>
                      )}

                      <button
                        onClick={onToggleDatasetBuildings}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-[11px] rounded-md transition-all flex items-center gap-2",
                          datasetBuildingsVisible
                            ? "bg-secondary font-semibold"
                            : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <Building2 className="h-3 w-3" />
                        Buildings
                        <Eye
                          className={cn("h-3 w-3 ml-auto", datasetBuildingsVisible ? "opacity-100" : "opacity-30")}
                        />
                      </button>
                      {datasetBuildingsVisible && onSetDatasetBuildingsOpacity && (
                        <div className="px-3 py-1">
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={datasetBuildingsOpacity}
                            onChange={(e) => onSetDatasetBuildingsOpacity(parseFloat(e.target.value))}
                            className="w-full h-1 accent-primary"
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Coordinates overlay */}
        <div className="absolute bottom-6 left-6 flex items-center gap-3 z-[1000] bg-card/90 backdrop-blur-md border border-border rounded-full px-4 py-2 shadow-xl border-primary/20">
          <Crosshair className="h-3.5 w-3.5 text-primary animate-pulse" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter leading-none mb-0.5">
              Location
            </span>
            <span className="text-xs font-mono font-bold text-foreground tabular-nums">
              {coordinates.lat.toFixed(5)}°N, {coordinates.lng.toFixed(5)}°W
            </span>
          </div>
          <div className="h-6 w-px bg-border mx-1" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter leading-none mb-0.5">
              Zoom
            </span>
            <span className="text-xs font-mono font-bold text-foreground tabular-nums">{zoom.toFixed(1)}</span>
          </div>
          {hasDataset && (
            <>
              <div className="h-6 w-px bg-border mx-1" />
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter leading-none mb-0.5">
                  Patches
                </span>
                <span className="text-xs font-mono font-bold text-foreground tabular-nums">
                  {visiblePatchCount}/{manifest!.count}
                </span>
              </div>
            </>
          )}
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
