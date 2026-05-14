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
  BrainCircuit,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { DatasetBounds, DatasetImageCoordinates, DatasetManifest, DatasetPatch } from "@/lib/types"
import { MapAction } from "@/lib/map-actions"
import maplibregl from "maplibre-gl"
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl"

const BASE_LAYERS = [
  {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, Maxar, Earthstar Geographics",
  },
  {
    name: "Terrain",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "OpenTopoMap",
  },
  {
    name: "Dark",
    url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "CartoDB",
  },
]

const PRELOAD_BATCH_SIZE = 4
const PRELOAD_START_DELAY_MS = 1400
const PRELOAD_BATCH_DELAY_MS = 40
const BUILDING_FETCH_CONCURRENCY = 8
const BUILDINGS_SOURCE_ID = "buildings-all"
const BUILDINGS_FILL_LAYER_ID = "buildings-all-fill"
const BUILDINGS_LINE_LAYER_ID = "buildings-all-line"
const PREDICTED_SOURCE_ID = "buildings-predicted"
const PREDICTED_FILL_LAYER_ID = "buildings-predicted-fill"
const PREDICTED_LINE_LAYER_ID = "buildings-predicted-line"
const DATASET_OUTLINE_SOURCE_ID = "dataset-outline"
const DATASET_OUTLINE_LAYER_ID = "dataset-outline-line"
const OUTLINE_GRID_SUBDIVISIONS = 24

const JOPLIN_LNG = -94.5133
const JOPLIN_LAT = 37.0842
const JOPLIN_MARKER_MAX_ZOOM = 9

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildStyle(tileUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      "base-tiles": {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
      },
    },
    layers: [{ id: "base-tiles", type: "raster", source: "base-tiles" }],
  }
}

// Leaflet bounds [[south,west],[north,east]] → MapLibre [[west,south],[east,north]]
function toMlBounds(b: [[number, number], [number, number]]): [[number, number], [number, number]] {
  const [[s, w], [n, e]] = b
  return [[w, s], [e, n]]
}

// Leaflet bounds → MapLibre image coords [NW, NE, SE, SW]
function toImageCoords(b: DatasetBounds): DatasetImageCoordinates {
  const [[s, w], [n, e]] = b
  return [[w, n], [e, n], [e, s], [w, s]]
}

function setMapProjection(map: MapLibreMap) {
  try {
    ;(map as any).setProjection({ type: "globe" })
  } catch {}
}

function getDisplayBounds(patch: DatasetPatch): DatasetBounds {
  return patch.snappedDisplayBounds ?? patch.displayBounds ?? patch.bounds
}

function getPreBounds(patch: DatasetPatch): DatasetBounds {
  return patch.snappedPreBounds ?? patch.preBounds ?? getDisplayBounds(patch)
}

function getPostBounds(patch: DatasetPatch): DatasetBounds {
  return patch.snappedPostBounds ?? patch.postBounds ?? getDisplayBounds(patch)
}

function getDisplayCoordinates(patch: DatasetPatch): DatasetImageCoordinates {
  return patch.snappedDisplayCoordinates ?? toImageCoords(getDisplayBounds(patch))
}

function getPreCoordinates(patch: DatasetPatch): DatasetImageCoordinates {
  return patch.snappedPreCoordinates ?? toImageCoords(getPreBounds(patch))
}

function getPostCoordinates(patch: DatasetPatch): DatasetImageCoordinates {
  return patch.snappedPostCoordinates ?? toImageCoords(getPostBounds(patch))
}

function getOriginalPostBounds(patch: DatasetPatch): DatasetBounds {
  return patch.postBounds ?? patch.displayBounds ?? patch.bounds
}

function damageColor(subtype: string): string {
  if (subtype === "no-damage") return "#22c55e"
  if (subtype === "minor-damage") return "#f59e0b"
  if (subtype === "major-damage") return "#ef4444"
  if (subtype === "destroyed") return "#7c3aed"
  return "#94a3b8"
}

function parseBuildingGeoJSON(raw: any): GeoJSON.FeatureCollection {
  const features = raw?.features?.lng_lat
  if (!features || !Array.isArray(features)) return { type: "FeatureCollection", features: [] }

  const getCoords = (wkt: string): [number, number][] => {
    const m = wkt.match(/\(\((.*?)\)\)/)
    return m
      ? m[1].split(",").map((p) => {
          const [x, y] = p.trim().split(" ").map(Number)
          return [x, y]
        })
      : []
  }

  return {
    type: "FeatureCollection",
    features: features.map((f: any) => {
      const subtype = (f.properties?.subtype || "unknown").trim().toLowerCase()
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [getCoords(f.wkt)] },
        properties: { ...f.properties, color: damageColor(subtype), subtype },
      }
    }),
  }
}

function remapPointToCoordinates(
  lng: number,
  lat: number,
  fromBounds: DatasetBounds,
  toCoordinates: DatasetImageCoordinates
): [number, number] {
  const fromWest = fromBounds[0][1]
  const fromSouth = fromBounds[0][0]
  const fromEast = fromBounds[1][1]
  const fromNorth = fromBounds[1][0]
  const [northWest, northEast, southEast, southWest] = toCoordinates
  const u = fromEast === fromWest ? 0 : (lng - fromWest) / (fromEast - fromWest)
  const v = fromNorth === fromSouth ? 0 : (lat - fromSouth) / (fromNorth - fromSouth)
  const bottomLng = southWest[0] + u * (southEast[0] - southWest[0])
  const bottomLat = southWest[1] + u * (southEast[1] - southWest[1])
  const topLng = northWest[0] + u * (northEast[0] - northWest[0])
  const topLat = northWest[1] + u * (northEast[1] - northWest[1])
  return [bottomLng + v * (topLng - bottomLng), bottomLat + v * (topLat - bottomLat)]
}

function remapFeatureCollectionToCoordinates(
  data: GeoJSON.FeatureCollection,
  fromBounds: DatasetBounds,
  toCoordinates: DatasetImageCoordinates
): GeoJSON.FeatureCollection {
  return {
    ...data,
    features: data.features.map((feature) => {
      if (feature.geometry.type !== "Polygon") return feature
      const coordinates = feature.geometry.coordinates.map((ring) =>
        ring.map(([lng, lat]) => remapPointToCoordinates(lng, lat, fromBounds, toCoordinates))
      )
      return { ...feature, geometry: { ...feature.geometry, coordinates } }
    }),
  }
}

function coordinateBounds(coordinates: DatasetImageCoordinates): DatasetBounds {
  const lons = coordinates.map(([lng]) => lng)
  const lats = coordinates.map(([, lat]) => lat)
  return [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)],
  ]
}

// Compute a non-convex outer perimeter for the dataset by rasterizing the tile
// collection in normalized tile space, then extracting the boundary of the
// occupied cells. This preserves the collection shape while absorbing the
// slight overlaps between neighboring tiles.
function buildDatasetOutlineFeatureCollection(
  patches: DatasetPatch[]
): GeoJSON.FeatureCollection {
  if (!patches.length) {
    return { type: "FeatureCollection", features: [] }
  }

  const anchor = getDisplayCoordinates(patches[0])
  const origin = anchor[0]
  const east: [number, number] = [
    anchor[1][0] - anchor[0][0],
    anchor[1][1] - anchor[0][1],
  ]
  const south: [number, number] = [
    anchor[3][0] - anchor[0][0],
    anchor[3][1] - anchor[0][1],
  ]
  const det = east[0] * south[1] - south[0] * east[1]
  if (Math.abs(det) < 1e-12) {
    return { type: "FeatureCollection", features: [] }
  }

  const project = ([lng, lat]: [number, number]): [number, number] => {
    const dx = lng - origin[0]
    const dy = lat - origin[1]
    return [
      (dx * south[1] - south[0] * dy) / det,
      (east[0] * dy - dx * east[1]) / det,
    ]
  }

  const unproject = (u: number, v: number): [number, number] => [
    origin[0] + u * east[0] + v * south[0],
    origin[1] + u * east[1] + v * south[1],
  ]

  const occupied = new Set<string>()
  const scale = OUTLINE_GRID_SUBDIVISIONS
  const cellKey = (x: number, y: number) => `${x}:${y}`

  for (const patch of patches) {
    const projected = getDisplayCoordinates(patch).map(project)
    const us = projected.map(([u]) => u)
    const vs = projected.map(([, v]) => v)
    const minX = Math.floor(Math.min(...us) * scale)
    const maxX = Math.ceil(Math.max(...us) * scale)
    const minY = Math.floor(Math.min(...vs) * scale)
    const maxY = Math.ceil(Math.max(...vs) * scale)

    for (let x = minX; x < maxX; x++) {
      for (let y = minY; y < maxY; y++) {
        occupied.add(cellKey(x, y))
      }
    }
  }

  const hasCell = (x: number, y: number) => occupied.has(cellKey(x, y))
  const segments: [ [number, number], [number, number] ][] = []

  for (const key of occupied) {
    const [xStr, yStr] = key.split(":")
    const x = Number.parseInt(xStr, 10)
    const y = Number.parseInt(yStr, 10)

    if (!hasCell(x, y - 1)) segments.push([unproject(x / scale, y / scale), unproject((x + 1) / scale, y / scale)])
    if (!hasCell(x + 1, y)) segments.push([unproject((x + 1) / scale, y / scale), unproject((x + 1) / scale, (y + 1) / scale)])
    if (!hasCell(x, y + 1)) segments.push([unproject((x + 1) / scale, (y + 1) / scale), unproject(x / scale, (y + 1) / scale)])
    if (!hasCell(x - 1, y)) segments.push([unproject(x / scale, (y + 1) / scale), unproject(x / scale, y / scale)])
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "MultiLineString",
          coordinates: segments,
        },
      },
    ],
  }
}

interface MapViewProps {
  className?: string
  mapActionRef?: { current: ((action: MapAction) => void) | null }
  manifest?: DatasetManifest | null
  datasetPreVisible?: boolean
  datasetPostVisible?: boolean
  datasetBuildingsVisible?: boolean
  datasetPredictedVisible?: boolean
  datasetPreOpacity?: number
  datasetPostOpacity?: number
  datasetBuildingsOpacity?: number
  datasetPredictedOpacity?: number
  onToggleDatasetPre?: () => void
  onToggleDatasetPost?: () => void
  onToggleDatasetBuildings?: () => void
  onToggleDatasetPredicted?: () => void
  onSetDatasetPreOpacity?: (v: number) => void
  onSetDatasetPostOpacity?: (v: number) => void
  onSetDatasetBuildingsOpacity?: (v: number) => void
  onSetDatasetPredictedOpacity?: (v: number) => void
}

export default function MapView({
  className,
  mapActionRef,
  manifest = null,
  datasetPreVisible = false,
  datasetPostVisible = false,
  datasetBuildingsVisible = false,
  datasetPredictedVisible = false,
  datasetPreOpacity = 1,
  datasetPostOpacity = 1,
  datasetBuildingsOpacity = 1,
  datasetPredictedOpacity = 1,
  onToggleDatasetPre,
  onToggleDatasetPost,
  onToggleDatasetBuildings,
  onToggleDatasetPredicted,
  onSetDatasetPreOpacity,
  onSetDatasetPostOpacity,
  onSetDatasetBuildingsOpacity,
  onSetDatasetPredictedOpacity,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<MapLibreMap | null>(null)

  const loadedPreRef = useRef<Set<string>>(new Set())
  const loadedPostRef = useRef<Set<string>>(new Set())
  const loadedBuildingsRef = useRef<Set<string>>(new Set())
  const loadedPredictedRef = useRef<Set<string>>(new Set())
  const buildingCacheRef = useRef<Record<string, GeoJSON.FeatureCollection>>({})
  const predictedCacheRef = useRef<Record<string, GeoJSON.FeatureCollection>>({})
  const preloadGenerationRef = useRef(0)
  const buildingLoadGenerationRef = useRef(0)
  const predictedLoadGenerationRef = useRef(0)
  const buildingLayerEventsAttachedRef = useRef(false)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const destroyTimerRef = useRef<NodeJS.Timeout | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const buildingPopupRef = useRef<maplibregl.Popup | null>(null)
  const joplinMarkerRef = useRef<maplibregl.Marker | null>(null)
  const markerFirstClickedRef = useRef(false)

  const [styleReady, setStyleReady] = useState(false)
  const [activeBaseLayer, setActiveBaseLayer] = useState(0)
  const [showLayerPicker, setShowLayerPicker] = useState(false)
  const [coordinates, setCoordinates] = useState({ lat: JOPLIN_LAT, lng: JOPLIN_LNG })
  const [zoom, setZoom] = useState(2)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [visiblePatchCount, setVisiblePatchCount] = useState(0)

  const layerStateRef = useRef({
    preVisible: datasetPreVisible,
    postVisible: datasetPostVisible,
    buildingsVisible: datasetBuildingsVisible,
    predictedVisible: datasetPredictedVisible,
    preOpacity: datasetPreOpacity,
    postOpacity: datasetPostOpacity,
    buildingsOpacity: datasetBuildingsOpacity,
    predictedOpacity: datasetPredictedOpacity,
  })

  useEffect(() => {
    layerStateRef.current = {
      preVisible: datasetPreVisible,
      postVisible: datasetPostVisible,
      buildingsVisible: datasetBuildingsVisible,
      predictedVisible: datasetPredictedVisible,
      preOpacity: datasetPreOpacity,
      postOpacity: datasetPostOpacity,
      buildingsOpacity: datasetBuildingsOpacity,
      predictedOpacity: datasetPredictedOpacity,
    }
  }, [datasetPreVisible, datasetPostVisible, datasetBuildingsVisible, datasetPredictedVisible, datasetPreOpacity, datasetPostOpacity, datasetBuildingsOpacity, datasetPredictedOpacity])

  // Dataset center-of-mass marker — appears on launch, hides past zoom threshold
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !styleReady || !manifest) return

    // Compute mean of all patch centers
    const patches = manifest.patches
    const centerLat = patches.reduce((s, p) => s + (p.bounds[0][0] + p.bounds[1][0]) / 2, 0) / patches.length
    const centerLng = patches.reduce((s, p) => s + (p.bounds[0][1] + p.bounds[1][1]) / 2, 0) / patches.length

    // Inject keyframes once
    if (!document.getElementById("joplin-pulse-style")) {
      const s = document.createElement("style")
      s.id = "joplin-pulse-style"
      s.textContent = `
        @keyframes joplin-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.55); }
          70%  { box-shadow: 0 0 0 12px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
        .joplin-marker:hover .joplin-pill { background: rgba(255,255,255,1); box-shadow: 0 4px 20px rgba(0,0,0,0.22); }
      `
      document.head.appendChild(s)
    }

    const el = document.createElement("div")
    el.className = "joplin-marker"
    el.style.cssText = "display:flex;flex-direction:column;align-items:center;cursor:pointer;transition:opacity 0.3s"
    el.innerHTML = `
      <div class="joplin-pill" style="
        display:flex;align-items:center;gap:6px;
        background:rgba(255,255,255,0.96);
        border:1.5px solid rgba(0,0,0,0.1);
        border-radius:999px;
        padding:5px 12px 5px 8px;
        box-shadow:0 2px 14px rgba(0,0,0,0.18);
        transition:background 0.15s,box-shadow 0.15s;
        white-space:nowrap;
      ">
        <span style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;box-shadow:0 0 0 2px rgba(239,68,68,0.25)"></span>
        <span style="color:#111;font-size:12px;font-weight:700;letter-spacing:0.02em;font-family:system-ui,sans-serif">Joplin, MO</span>
      </div>
      <div style="width:1.5px;height:8px;background:rgba(0,0,0,0.18);flex-shrink:0"></div>
      <div style="
        width:14px;height:14px;border-radius:50%;
        background:#ef4444;border:2.5px solid #fff;
        box-shadow:0 0 0 0 rgba(239,68,68,0.55);
        animation:joplin-pulse 2s ease-out infinite;
        flex-shrink:0;
      "></div>
    `

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([centerLng, centerLat])
      .addTo(map)

    joplinMarkerRef.current = marker

    el.addEventListener("click", () => {
      map.flyTo({ center: [centerLng, centerLat], zoom: 13, duration: 3000 })
      if (!markerFirstClickedRef.current) {
        markerFirstClickedRef.current = true
        setShowLayerPicker(true)
      }
    })

    return () => {
      marker.remove()
      joplinMarkerRef.current = null
    }
  }, [styleReady, manifest])

  // Hide/show Joplin marker based on React zoom state (updates on every map move)
  useEffect(() => {
    const el = joplinMarkerRef.current?.getElement()
    if (!el) return
    const hidden = zoom > JOPLIN_MARKER_MAX_ZOOM
    el.style.opacity = hidden ? "0" : "1"
    el.style.pointerEvents = hidden ? "none" : "auto"
  }, [zoom])

  // Initialize map — uses delayed destroy so React Strict Mode's double-fire
  // cancels the pending cleanup instead of tearing down the WebGL context.
  useEffect(() => {
    if (destroyTimerRef.current) {
      clearTimeout(destroyTimerRef.current)
      destroyTimerRef.current = null
    }

    if (!mapRef.current || mapInstanceRef.current) return

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: buildStyle(BASE_LAYERS[0].url), // satellite on launch
      center: [-90, 20],                      // facing Americas
      zoom: 3,                                // whole globe visible, slightly closer
      attributionControl: false,
      failIfMajorPerformanceCaveat: false,
      fadeDuration: 0,
      refreshExpiredTiles: false,
      maxTileCacheSize: 10000,
      maxTileCacheZoomLevels: 10,
      prefetchZoomDelta: 4,
    } as any)

    map.on("style.load", () => {
      setMapProjection(map)
      setStyleReady(true)
    })

    map.on("move", () => {
      const c = map.getCenter()
      setCoordinates({ lat: c.lat, lng: c.lng })
      setZoom(map.getZoom())
    })

    mapInstanceRef.current = map

    return () => {
      setStyleReady(false)
      const m = map
      destroyTimerRef.current = setTimeout(() => {
        destroyTimerRef.current = null
        mapInstanceRef.current = null
        m.remove()
      }, 200)
    }
  }, [])

  const getVisiblePatches = useCallback((): DatasetPatch[] => {
    if (!manifest || !mapInstanceRef.current) return []
    const b = mapInstanceRef.current.getBounds()
    return manifest.patches.filter((p) => {
      const [[s, w], [n, e]] = coordinateBounds(getDisplayCoordinates(p))
      return b.getEast() >= w && b.getWest() <= e && b.getNorth() >= s && b.getSouth() <= n
    })
  }, [manifest])

  const addPre = useCallback((map: MapLibreMap, patch: DatasetPatch, opacity: number) => {
    const id = `pre-${patch.id}`
    if (!map.getSource(id)) {
      map.addSource(id, { type: "image", url: patch.pre, coordinates: getPreCoordinates(patch) })
    }
    if (!map.getLayer(id)) {
      map.addLayer(
        { id, type: "raster", source: id, paint: { "raster-opacity": opacity } },
        map.getLayer(BUILDINGS_FILL_LAYER_ID) ? BUILDINGS_FILL_LAYER_ID : undefined
      )
    } else {
      map.setPaintProperty(id, "raster-opacity", opacity)
    }
    loadedPreRef.current.add(patch.id)
  }, [])

  const addPost = useCallback((map: MapLibreMap, patch: DatasetPatch, opacity: number) => {
    const id = `post-${patch.id}`
    if (!map.getSource(id)) {
      map.addSource(id, { type: "image", url: patch.post, coordinates: getPostCoordinates(patch) })
    }
    if (!map.getLayer(id)) {
      map.addLayer(
        { id, type: "raster", source: id, paint: { "raster-opacity": opacity } },
        map.getLayer(BUILDINGS_FILL_LAYER_ID) ? BUILDINGS_FILL_LAYER_ID : undefined
      )
    } else {
      map.setPaintProperty(id, "raster-opacity", opacity)
    }
    loadedPostRef.current.add(patch.id)
  }, [])

  const attachBuildingInteractions = useCallback((map: MapLibreMap) => {
    if (buildingLayerEventsAttachedRef.current) return
    buildingLayerEventsAttachedRef.current = true

    map.on("click", BUILDINGS_FILL_LAYER_ID, (e) => {
      const feature = e.features?.[0]
      if (!feature) return
      const props = feature.properties as { uid?: string; subtype?: string; color?: string; patchId?: string }
      const label = (props.subtype ?? "unknown").replace(/-/g, " ")
      const color = props.color ?? "#94a3b8"
      buildingPopupRef.current?.remove()
      buildingPopupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "240px" })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:monospace;font-size:11px;line-height:1.6;padding:2px 0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>
              <strong style="text-transform:capitalize;font-size:12px">${label}</strong>
            </div>
            <div style="color:#888;font-size:10px;word-break:break-all">${props.uid ?? "unknown"}</div>
            <div style="color:#888;font-size:10px">patch ${props.patchId ?? "unknown"}</div>
          </div>
        `)
        .addTo(map)
    })

    map.on("mouseenter", BUILDINGS_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = "pointer" })
    map.on("mouseleave", BUILDINGS_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = "" })
  }, [])

  const loadCombinedBuildings = useCallback(async (patches: DatasetPatch[]): Promise<GeoJSON.FeatureCollection> => {
    const features: GeoJSON.Feature[] = []
    let nextIndex = 0
    const workerCount = Math.min(BUILDING_FETCH_CONCURRENCY, patches.length)

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < patches.length) {
        const patch = patches[nextIndex++]
        try {
          let rawData = buildingCacheRef.current[patch.id]
          if (!rawData) {
            const res = await fetch(patch.postJson)
            if (!res.ok) continue
            rawData = parseBuildingGeoJSON(await res.json())
            buildingCacheRef.current[patch.id] = rawData
          }
          const transformed = remapFeatureCollectionToCoordinates(
            rawData,
            getOriginalPostBounds(patch),
            getPostCoordinates(patch)
          )
          features.push(...transformed.features.map((feature) => ({
            ...feature,
            properties: { ...(feature.properties ?? {}), patchId: patch.id },
          })))
        } catch {
          // skip bad patch
        }
      }
    }))

    return { type: "FeatureCollection", features }
  }, [])

  const ensureBuildingsLayer = useCallback((map: MapLibreMap, opacity: number) => {
    if (!map.getSource(BUILDINGS_SOURCE_ID)) {
      map.addSource(BUILDINGS_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      })
    }
    if (!map.getLayer(BUILDINGS_FILL_LAYER_ID)) {
      map.addLayer({
        id: BUILDINGS_FILL_LAYER_ID,
        type: "fill",
        source: BUILDINGS_SOURCE_ID,
        layout: { visibility: opacity > 0 ? "visible" : "none" },
        paint: { "fill-color": ["get", "color"], "fill-opacity": opacity * 0.5 },
      })
    }
    if (!map.getLayer(BUILDINGS_LINE_LAYER_ID)) {
      map.addLayer({
        id: BUILDINGS_LINE_LAYER_ID,
        type: "line",
        source: BUILDINGS_SOURCE_ID,
        layout: { visibility: opacity > 0 ? "visible" : "none" },
        paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": opacity },
      })
    }
    attachBuildingInteractions(map)
  }, [attachBuildingInteractions])

  const ensureDatasetOutlineLayer = useCallback((map: MapLibreMap, visible: boolean) => {
    if (!map.getSource(DATASET_OUTLINE_SOURCE_ID)) {
      map.addSource(DATASET_OUTLINE_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      })
    }
    if (!map.getLayer(DATASET_OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: DATASET_OUTLINE_LAYER_ID,
        type: "line",
        source: DATASET_OUTLINE_SOURCE_ID,
        layout: { visibility: visible ? "visible" : "none" },
        paint: {
          "line-color": "#ef4444",
          "line-width": 2,
          "line-opacity": 0.45,
        },
      })
    }
  }, [])

  const setDatasetOutlineVisibility = useCallback((map: MapLibreMap, visible: boolean) => {
    if (map.getLayer(DATASET_OUTLINE_LAYER_ID)) {
      map.setLayoutProperty(DATASET_OUTLINE_LAYER_ID, "visibility", visible ? "visible" : "none")
    }
  }, [])

  const setBuildingsOpacity = useCallback((map: MapLibreMap, opacity: number) => {
    const visibility = opacity > 0 ? "visible" : "none"
    if (map.getLayer(BUILDINGS_FILL_LAYER_ID)) {
      map.setLayoutProperty(BUILDINGS_FILL_LAYER_ID, "visibility", visibility)
      map.setPaintProperty(BUILDINGS_FILL_LAYER_ID, "fill-opacity", opacity * 0.5)
    }
    if (map.getLayer(BUILDINGS_LINE_LAYER_ID)) {
      map.setLayoutProperty(BUILDINGS_LINE_LAYER_ID, "visibility", visibility)
      map.setPaintProperty(BUILDINGS_LINE_LAYER_ID, "line-opacity", opacity)
    }
  }, [])

  const loadCombinedPredicted = useCallback(async (patches: DatasetPatch[]): Promise<GeoJSON.FeatureCollection> => {
    const features: GeoJSON.Feature[] = []
    const eligible = patches.filter((p) => !!p.predictedJson)
    let nextIndex = 0
    const workerCount = Math.min(BUILDING_FETCH_CONCURRENCY, eligible.length)

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < eligible.length) {
        const patch = eligible[nextIndex++]
        try {
          let rawData = predictedCacheRef.current[patch.id]
          if (!rawData) {
            const res = await fetch(patch.predictedJson!)
            if (!res.ok) continue
            rawData = parseBuildingGeoJSON(await res.json())
            predictedCacheRef.current[patch.id] = rawData
          }
          const transformed = remapFeatureCollectionToCoordinates(
            rawData,
            getOriginalPostBounds(patch),
            getPostCoordinates(patch)
          )
          features.push(...transformed.features.map((feature) => ({
            ...feature,
            properties: { ...(feature.properties ?? {}), patchId: patch.id },
          })))
        } catch {
          // skip bad patch
        }
      }
    }))

    return { type: "FeatureCollection", features }
  }, [])

  const ensurePredictedLayer = useCallback((map: MapLibreMap, opacity: number) => {
    if (!map.getSource(PREDICTED_SOURCE_ID)) {
      map.addSource(PREDICTED_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      })
    }
    // Predicted labels: dashed outline only — visually distinct from solid true labels
    if (!map.getLayer(PREDICTED_FILL_LAYER_ID)) {
      map.addLayer({
        id: PREDICTED_FILL_LAYER_ID,
        type: "fill",
        source: PREDICTED_SOURCE_ID,
        layout: { visibility: opacity > 0 ? "visible" : "none" },
        paint: { "fill-color": ["get", "color"], "fill-opacity": opacity * 0.15 },
      })
    }
    if (!map.getLayer(PREDICTED_LINE_LAYER_ID)) {
      map.addLayer({
        id: PREDICTED_LINE_LAYER_ID,
        type: "line",
        source: PREDICTED_SOURCE_ID,
        layout: { visibility: opacity > 0 ? "visible" : "none" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": opacity,
          "line-dasharray": [3, 2],
        },
      })
    }
  }, [])

  const setPredictedOpacity = useCallback((map: MapLibreMap, opacity: number) => {
    const visibility = opacity > 0 ? "visible" : "none"
    if (map.getLayer(PREDICTED_FILL_LAYER_ID)) {
      map.setLayoutProperty(PREDICTED_FILL_LAYER_ID, "visibility", visibility)
      map.setPaintProperty(PREDICTED_FILL_LAYER_ID, "fill-opacity", opacity * 0.15)
    }
    if (map.getLayer(PREDICTED_LINE_LAYER_ID)) {
      map.setLayoutProperty(PREDICTED_LINE_LAYER_ID, "visibility", visibility)
      map.setPaintProperty(PREDICTED_LINE_LAYER_ID, "line-opacity", opacity)
    }
  }, [])

  // Staggered preload: wait for base tiles to settle, then add overlay sources in small batches
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !styleReady || !manifest) return

    const outlineVisible = layerStateRef.current.preVisible || layerStateRef.current.postVisible
    ensureDatasetOutlineLayer(map, outlineVisible)
    const outlineSource = map.getSource(DATASET_OUTLINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    outlineSource?.setData(buildDatasetOutlineFeatureCollection(manifest.patches))

    const generation = ++preloadGenerationRef.current
    let cancelled = false

    const preload = async () => {
      // Let base satellite tiles render first before stressing WebGL with overlay sources
      await wait(PRELOAD_START_DELAY_MS)
      if (cancelled || generation !== preloadGenerationRef.current) return

      setVisiblePatchCount(getVisiblePatches().length)

      for (let i = 0; i < manifest.patches.length; i += PRELOAD_BATCH_SIZE) {
        if (cancelled || generation !== preloadGenerationRef.current) return
        const batch = manifest.patches.slice(i, i + PRELOAD_BATCH_SIZE)
        for (const patch of batch) {
          const { preVisible, preOpacity } = layerStateRef.current
          addPre(map, patch, preVisible ? preOpacity : 0)
        }
        await wait(PRELOAD_BATCH_DELAY_MS)
      }

      for (let i = 0; i < manifest.patches.length; i += PRELOAD_BATCH_SIZE) {
        if (cancelled || generation !== preloadGenerationRef.current) return
        const batch = manifest.patches.slice(i, i + PRELOAD_BATCH_SIZE)
        for (const patch of batch) {
          const { postVisible, postOpacity } = layerStateRef.current
          addPost(map, patch, postVisible ? postOpacity : 0)
        }
        await wait(PRELOAD_BATCH_DELAY_MS)
      }
    }

    void preload()
    return () => { cancelled = true }
  }, [manifest, styleReady, getVisiblePatches, addPre, addPost, ensureDatasetOutlineLayer])

  // Preload combined building layer (also staggered — starts after overlay preload settles)
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !styleReady || !manifest) return

    const { buildingsVisible, buildingsOpacity } = layerStateRef.current
    ensureBuildingsLayer(map, buildingsVisible ? buildingsOpacity : 0)
    setBuildingsOpacity(map, buildingsVisible ? buildingsOpacity : 0)

    const generation = ++buildingLoadGenerationRef.current
    let cancelled = false

    const load = async () => {
      // Delay building fetch so it doesn't compete with overlay image preload
      await wait(PRELOAD_START_DELAY_MS + 500)
      if (cancelled || generation !== buildingLoadGenerationRef.current) return

      const data = await loadCombinedBuildings(manifest.patches)
      if (cancelled || generation !== buildingLoadGenerationRef.current) return

      const source = map.getSource(BUILDINGS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      source?.setData(data)
      loadedBuildingsRef.current = new Set(manifest.patches.map((p) => p.id))
    }

    void load()
    return () => { cancelled = true }
  }, [manifest, styleReady, loadCombinedBuildings, ensureBuildingsLayer, setBuildingsOpacity])

  // Predicted labels layer — fetches from generated_labels prefix, dashed outline rendering
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !styleReady || !manifest) return

    const { predictedVisible, predictedOpacity } = layerStateRef.current
    ensurePredictedLayer(map, predictedVisible ? predictedOpacity : 0)
    setPredictedOpacity(map, predictedVisible ? predictedOpacity : 0)

    const generation = ++predictedLoadGenerationRef.current
    let cancelled = false

    const load = async () => {
      await wait(PRELOAD_START_DELAY_MS + 800)
      if (cancelled || generation !== predictedLoadGenerationRef.current) return

      const data = await loadCombinedPredicted(manifest.patches)
      if (cancelled || generation !== predictedLoadGenerationRef.current) return

      const source = map.getSource(PREDICTED_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      source?.setData(data)
      loadedPredictedRef.current = new Set(manifest.patches.map((p) => p.id))
    }

    void load()
    return () => { cancelled = true }
  }, [manifest, styleReady, loadCombinedPredicted, ensurePredictedLayer, setPredictedOpacity])

  // Opacity updates
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    for (const id of loadedPreRef.current) {
      if (map.getLayer(`pre-${id}`)) {
        map.setPaintProperty(`pre-${id}`, "raster-opacity", datasetPreVisible ? datasetPreOpacity : 0)
      }
    }
    setDatasetOutlineVisibility(map, datasetPreVisible || datasetPostVisible)
  }, [datasetPreVisible, datasetPostVisible, datasetPreOpacity, setDatasetOutlineVisibility])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    for (const id of loadedPostRef.current) {
      if (map.getLayer(`post-${id}`)) {
        map.setPaintProperty(`post-${id}`, "raster-opacity", datasetPostVisible ? datasetPostOpacity : 0)
      }
    }
    setDatasetOutlineVisibility(map, datasetPreVisible || datasetPostVisible)
  }, [datasetPreVisible, datasetPostVisible, datasetPostOpacity, setDatasetOutlineVisibility])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    setBuildingsOpacity(map, datasetBuildingsVisible ? datasetBuildingsOpacity : 0)
  }, [datasetBuildingsVisible, datasetBuildingsOpacity, setBuildingsOpacity])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    setPredictedOpacity(map, datasetPredictedVisible ? datasetPredictedOpacity : 0)
  }, [datasetPredictedVisible, datasetPredictedOpacity, setPredictedOpacity])

  // Map move only updates visible patch count
  const handleMapMove = useCallback(() => {
    const map = mapInstanceRef.current
    if (!map || !manifest) return
    setVisiblePatchCount(getVisiblePatches().length)
  }, [manifest, getVisiblePatches])

  const debouncedHandleMapMove = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(handleMapMove, 150)
  }, [handleMapMove])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    map.on("moveend", debouncedHandleMapMove)
    return () => {
      map.off("moveend", debouncedHandleMapMove)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [debouncedHandleMapMove])

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      setTimeout(() => mapInstanceRef.current?.resize(), 50)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const switchBaseLayer = useCallback((index: number) => {
    const map = mapInstanceRef.current
    if (!map) return

    const baseSource = map.getSource("base-tiles") as { setTiles?: (tiles: string[]) => void } | undefined
    if (baseSource?.setTiles) {
      baseSource.setTiles([BASE_LAYERS[index].url])
    } else {
      loadedPreRef.current.clear()
      loadedPostRef.current.clear()
      loadedBuildingsRef.current.clear()
      loadedPredictedRef.current.clear()
      preloadGenerationRef.current += 1
      buildingLoadGenerationRef.current += 1
      predictedLoadGenerationRef.current += 1
      setStyleReady(false)

      map.setStyle(buildStyle(BASE_LAYERS[index].url))
      map.once("style.load", () => {
        setMapProjection(map)
        setStyleReady(true)
      })
    }

    setActiveBaseLayer(index)
    setShowLayerPicker(false)
  }, [])

  const switchBaseLayerRef = useRef(switchBaseLayer)
  useEffect(() => { switchBaseLayerRef.current = switchBaseLayer }, [switchBaseLayer])
  const manifestRef = useRef(manifest)
  useEffect(() => { manifestRef.current = manifest }, [manifest])

  useEffect(() => {
    if (!mapActionRef) return
    mapActionRef.current = (action: MapAction) => {
      const map = mapInstanceRef.current
      if (!map) return
      switch (action.type) {
        case "fly_to":
          map.flyTo({ center: [action.lng, action.lat], zoom: action.zoom ?? 10, duration: 2000 })
          break
        case "fit_bounds":
          map.fitBounds([[action.west, action.south], [action.east, action.north]], { padding: 60, duration: 2000 })
          break
        case "set_zoom":
          map.easeTo({ zoom: action.zoom, duration: 800 })
          break
        case "set_base_layer": {
          const idx = { satellite: 0, terrain: 1, dark: 2 }[action.layer]
          switchBaseLayerRef.current(idx)
          break
        }
        case "place_marker": {
          const pinEl = document.createElement("div")
          pinEl.style.cssText = "display:flex;flex-direction:column;align-items:center;cursor:pointer"
          pinEl.innerHTML = `
            ${action.label ? `<div style="
              background:rgba(255,255,255,0.97);color:#111;font-size:11px;font-weight:700;
              padding:4px 10px;border-radius:999px;white-space:nowrap;
              box-shadow:0 2px 10px rgba(0,0,0,0.18);border:1.5px solid rgba(0,0,0,0.09);
              font-family:system-ui,sans-serif;letter-spacing:0.01em;margin-bottom:4px;
            ">${action.label}</div>` : ""}
            <div style="
              width:20px;height:20px;border-radius:50% 50% 50% 0;
              transform:rotate(-45deg);background:#7c3aed;
              border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.25);
            "></div>
          `
          const marker = new maplibregl.Marker({ element: pinEl, anchor: "bottom" })
            .setLngLat([action.lng, action.lat])
          marker.addTo(map)
          map.flyTo({ center: [action.lng, action.lat], zoom: Math.max(map.getZoom(), 8), duration: 1500 })
          markersRef.current.push(marker)
          break
        }
        case "clear_markers":
          for (const m of markersRef.current) m.remove()
          markersRef.current = []
          break
        case "fit_to_dataset":
          if (manifestRef.current) {
            map.fitBounds(toMlBounds(manifestRef.current.totalBounds), { padding: 50, maxZoom: 15, duration: 2000 })
          }
          break
      }
    }
    return () => { if (mapActionRef) mapActionRef.current = null }
  }, [mapActionRef])

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
                          datasetPreVisible ? "bg-secondary font-semibold" : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <Satellite className="h-3 w-3" />
                        Pre-Disaster
                        <Eye className={cn("h-3 w-3 ml-auto", datasetPreVisible ? "opacity-100" : "opacity-30")} />
                      </button>
                      {datasetPreVisible && onSetDatasetPreOpacity && (
                        <div className="px-3 py-1">
                          <input
                            type="range" min="0" max="1" step="0.1"
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
                          datasetPostVisible ? "bg-secondary font-semibold" : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <Satellite className="h-3 w-3" />
                        Post-Disaster
                        <Eye className={cn("h-3 w-3 ml-auto", datasetPostVisible ? "opacity-100" : "opacity-30")} />
                      </button>
                      {datasetPostVisible && onSetDatasetPostOpacity && (
                        <div className="px-3 py-1">
                          <input
                            type="range" min="0" max="1" step="0.1"
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
                          datasetBuildingsVisible ? "bg-secondary font-semibold" : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <Building2 className="h-3 w-3" />
                        True Labels
                        <Eye className={cn("h-3 w-3 ml-auto", datasetBuildingsVisible ? "opacity-100" : "opacity-30")} />
                      </button>
                      {datasetBuildingsVisible && onSetDatasetBuildingsOpacity && (
                        <div className="px-3 py-1">
                          <input
                            type="range" min="0" max="1" step="0.1"
                            value={datasetBuildingsOpacity}
                            onChange={(e) => onSetDatasetBuildingsOpacity(parseFloat(e.target.value))}
                            className="w-full h-1 accent-primary"
                          />
                        </div>
                      )}

                      <button
                        onClick={onToggleDatasetPredicted}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-[11px] rounded-md transition-all flex items-center gap-2",
                          datasetPredictedVisible ? "bg-secondary font-semibold" : "text-foreground hover:bg-secondary"
                        )}
                      >
                        <BrainCircuit className="h-3 w-3" />
                        Predicted Labels
                        <Eye className={cn("h-3 w-3 ml-auto", datasetPredictedVisible ? "opacity-100" : "opacity-30")} />
                      </button>
                      {datasetPredictedVisible && onSetDatasetPredictedOpacity && (
                        <div className="px-3 py-1">
                          <input
                            type="range" min="0" max="1" step="0.1"
                            value={datasetPredictedOpacity}
                            onChange={(e) => onSetDatasetPredictedOpacity(parseFloat(e.target.value))}
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
