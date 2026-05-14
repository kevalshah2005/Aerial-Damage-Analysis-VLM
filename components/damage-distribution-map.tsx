'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { DatasetPatch, DatasetImageCoordinates, DatasetBounds } from '@/lib/types'

interface GeoComparisonPatch {
  patchId: string
  total: number
  correct: number
  accuracy: number
  actualSevere: number
  predictedSevere: number
  severeDelta: number
}

interface GeoStatsPatch {
  id: string
  centroid: { lat: number; lon: number }
  buildingCount: number
  projection: number
  post: string | null
}

interface Corridor {
  center: { lat: number; lon: number }
  corners: [number, number][]
  axisStart: [number, number]
  axisEnd: [number, number]
  lengthKm: number
  widthKm: number
  bearingDeg: number
}

interface Props {
  patches: GeoStatsPatch[]
  comparison: GeoComparisonPatch[]
  corridor: Corridor
}

// ─── Polynomial path fitting ───────────────────────────────────────────────

function gaussElim(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row
    }
    if (Math.abs(M[pivotRow][col]) < 1e-14) return null
    ;[M[col], M[pivotRow]] = [M[pivotRow], M[col]]
    const pivot = M[col][col]
    for (let j = col; j <= n; j++) M[col][j] /= pivot
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = M[row][col]
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j]
    }
  }
  return M.map(row => row[n])
}

function fitPath(
  pts: Array<{ lon: number; lat: number; weight: number }>,
  degree = 2,
  nOut = 100
): [number, number][] {
  const valid = pts.filter(p => p.weight > 0)
  if (valid.length < degree + 2) return []

  const totalW = valid.reduce((s, p) => s + p.weight, 0)
  const lonMean = valid.reduce((s, p) => s + p.lon * p.weight, 0) / totalW
  const lonVar = valid.reduce((s, p) => s + p.weight * (p.lon - lonMean) ** 2, 0) / totalW
  const lonStd = Math.sqrt(lonVar) || 1

  const xs = valid.map(p => (p.lon - lonMean) / lonStd)
  const ys = valid.map(p => p.lat)
  const ws = valid.map(p => p.weight)

  const nd = degree + 1
  const XtWX = Array.from({ length: nd }, () => new Array(nd).fill(0))
  const XtWy = new Array(nd).fill(0)
  for (let i = 0; i < xs.length; i++) {
    const phi = Array.from({ length: nd }, (_, k) => xs[i] ** k)
    for (let j = 0; j < nd; j++) {
      XtWy[j] += ws[i] * phi[j] * ys[i]
      for (let k = 0; k < nd; k++) XtWX[j][k] += ws[i] * phi[j] * phi[k]
    }
  }
  const coeffs = gaussElim(XtWX, XtWy)
  if (!coeffs) return []

  const lonMin = Math.min(...valid.map(p => p.lon))
  const lonMax = Math.max(...valid.map(p => p.lon))
  return Array.from({ length: nOut }, (_, i) => {
    const lon = lonMin + (i / (nOut - 1)) * (lonMax - lonMin)
    const xn = (lon - lonMean) / lonStd
    const lat = coeffs.reduce((s, c, k) => s + c * xn ** k, 0)
    return [lon, lat] as [number, number]
  })
}

// ─── Image coord helpers (mirrors map-view.tsx) ──────────────────────────

function toImageCoords(b: DatasetBounds): DatasetImageCoordinates {
  const [[s, w], [n, e]] = b
  return [[w, n], [e, n], [e, s], [w, s]]
}

function patchPostCoords(p: DatasetPatch): DatasetImageCoordinates {
  return p.snappedPostCoordinates
    ?? toImageCoords(p.snappedPostBounds ?? p.postBounds ?? p.displayBounds ?? p.bounds)
}

// ─── Component ────────────────────────────────────────────────────────────

export default function DamageDistributionMap({ patches, comparison, corridor }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const loadedRef = useRef(new Set<string>())
  const layersReadyRef = useRef(false)

  const [mapReady, setMapReady] = useState(false)
  const [manifestMap, setManifestMap] = useState<Map<string, DatasetPatch>>(new Map())
  const [showActual, setShowActual] = useState(true)
  const [showPredicted, setShowPredicted] = useState(true)

  const byPatch = useMemo(() => new Map(comparison.map(c => [c.patchId, c])), [comparison])

  // Fetch augmented manifest (has snapped + offset-corrected coords)
  useEffect(() => {
    fetch('/api/dataset/manifest')
      .then(r => r.json())
      .then((data: { patches: DatasetPatch[] }) => {
        setManifestMap(new Map(data.patches.map(p => [p.id, p])))
      })
      .catch(() => {})
  }, [])

  // Compute fitted tornado paths
  const { actualPath, predictedPath, histData, actualFit, predictedFit } = useMemo(() => {
    const projMin = Math.min(...patches.map(p => p.projection))
    const projMax = Math.max(...patches.map(p => p.projection))
    const projRange = projMax - projMin || 1

    const actualPts = patches.map(p => ({
      lon: p.centroid.lon,
      lat: p.centroid.lat,
      weight: byPatch.get(p.id)?.actualSevere ?? 0,
    }))
    const predictedPts = patches.map(p => ({
      lon: p.centroid.lon,
      lat: p.centroid.lat,
      weight: byPatch.get(p.id)?.predictedSevere ?? 0,
    }))

    const actualPath = fitPath(actualPts, 2)
    const predictedPath = fitPath(predictedPts, 2)

    // Summary stats for fitted paths
    const centroid = (path: [number, number][]): { lat: number; lon: number } | null => {
      if (!path.length) return null
      const meanLon = path.reduce((s, [lon]) => s + lon, 0) / path.length
      const meanLat = path.reduce((s, [, lat]) => s + lat, 0) / path.length
      return { lat: meanLat, lon: meanLon }
    }

    // Max lateral deviation between paths (in km)
    const KM_PER_DEG_LAT = 111
    let maxDevKm = 0
    for (let i = 0; i < Math.min(actualPath.length, predictedPath.length); i++) {
      const dLat = (predictedPath[i][1] - actualPath[i][1]) * KM_PER_DEG_LAT
      const dLon = (predictedPath[i][0] - actualPath[i][0]) * KM_PER_DEG_LAT * Math.cos(actualPath[i][1] * Math.PI / 180)
      maxDevKm = Math.max(maxDevKm, Math.sqrt(dLat ** 2 + dLon ** 2))
    }

    // Histogram: actual vs predicted severe damage per km bin
    const NUM_BINS = 18
    const histBins = Array.from({ length: NUM_BINS }, (_, i) => ({
      label: `${Math.round((i / NUM_BINS) * corridor.lengthKm)}–${Math.round(((i + 1) / NUM_BINS) * corridor.lengthKm)}km`,
      actual: 0,
      predicted: 0,
    }))
    patches.forEach(p => {
      const norm = (p.projection - projMin) / projRange
      const bin = Math.min(NUM_BINS - 1, Math.floor(norm * NUM_BINS))
      const cmp = byPatch.get(p.id)
      if (cmp) {
        histBins[bin].actual += cmp.actualSevere
        histBins[bin].predicted += cmp.predictedSevere
      }
    })

    return {
      actualPath,
      predictedPath,
      histData: histBins,
      actualFit: { centroid: centroid(actualPath) },
      predictedFit: { centroid: centroid(predictedPath), maxDevKm: Math.round(maxDevKm * 10) / 10 },
    }
  }, [patches, comparison, byPatch, corridor.lengthKm])

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Esri',
          },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
      center: [corridor.center.lon, corridor.center.lat],
      zoom: 12.5,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.on('style.load', () => setMapReady(true))
    mapRef.current = map
    return () => {
      mapRef.current = null
      layersReadyRef.current = false
      map.remove()
    }
  }, [corridor.center.lat, corridor.center.lon])

  // Add damage + path layers once map + manifest are ready
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || manifestMap.size === 0 || layersReadyRef.current) return
    layersReadyRef.current = true

    // ── Post-disaster imagery ─────────────────────────────────────────────
    // Load all patches from the manifest using snapped coordinates (same as map-view)
    // Insert below the damage circles (add imagery sources first, then circles on top)
    for (const [id, mp] of manifestMap) {
      const srcId = `post-${id}`
      if (!map.getSource(srcId)) {
        const coords = patchPostCoords(mp)
        map.addSource(srcId, { type: 'image', url: mp.post, coordinates: coords })
        map.addLayer({ id: srcId, type: 'raster', source: srcId, paint: { 'raster-opacity': 0.88 } })
      }
      loadedRef.current.add(id)
    }

    // ── Damage circles (GeoJSON) ──────────────────────────────────────────
    const actualFeatures = patches.map(p => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.centroid.lon, p.centroid.lat] },
      properties: {
        patchId: p.id,
        actualSevere: byPatch.get(p.id)?.actualSevere ?? 0,
        predictedSevere: byPatch.get(p.id)?.predictedSevere ?? 0,
        total: byPatch.get(p.id)?.total ?? p.buildingCount,
      },
    })).filter(f => f.properties.total > 0)

    map.addSource('damage-actual', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: actualFeatures },
    })
    map.addSource('damage-predicted', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: actualFeatures },
    })

    const severityColor = (field: string) => ([
      'interpolate', ['linear'],
      ['/', ['get', field], ['max', ['get', 'total'], 1]],
      0, '#22c55e',
      0.2, '#facc15',
      0.5, '#f97316',
      1.0, '#a855f7',
    ] as maplibregl.ExpressionSpecification)

    map.addLayer({
      id: 'damage-actual',
      type: 'circle',
      source: 'damage-actual',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'total'], 0, 5, 300, 22] as maplibregl.ExpressionSpecification,
        'circle-color': severityColor('actualSevere'),
        'circle-opacity': 0.78,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': 'rgba(255,255,255,0.25)',
      },
    })

    map.addLayer({
      id: 'damage-predicted',
      type: 'circle',
      source: 'damage-predicted',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'total'], 0, 5, 300, 22] as maplibregl.ExpressionSpecification,
        'circle-color': 'transparent',
        'circle-opacity': 1,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': severityColor('predictedSevere'),
        'circle-stroke-opacity': 0.85,
      },
    })

    // ── Fitted tornado paths ──────────────────────────────────────────────
    const addPath = (id: string, coords: [number, number][], color: string, dasharray: number[]) => {
      if (!coords.length) return
      map.addSource(id, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
      })
      // Glow / shadow
      map.addLayer({
        id: `${id}-glow`,
        type: 'line',
        source: id,
        paint: { 'line-color': color, 'line-width': 10, 'line-opacity': 0.12, 'line-blur': 6 },
      })
      map.addLayer({
        id,
        type: 'line',
        source: id,
        paint: {
          'line-color': color,
          'line-width': 2.5,
          'line-opacity': 0.95,
          'line-dasharray': dasharray as [number, ...number[]],
        },
      })
    }

    addPath('path-actual', actualPath, '#34d399', [1])           // solid green
    addPath('path-predicted', predictedPath, '#f59e0b', [6, 3])  // dashed amber

    // ── Popup ────────────────────────────────────────────────────────────
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true })
    for (const layerId of ['damage-actual', 'damage-predicted']) {
      map.on('click', layerId, e => {
        const f = e.features?.[0]
        if (!f) return
        const props = f.properties as Record<string, unknown>
        const pId = String(props.patchId ?? '')
        const cmp = byPatch.get(pId)
        if (!cmp) return
        const coord = (f.geometry as unknown as { coordinates: [number, number] }).coordinates
        popup.setLngLat(coord)
          .setHTML(`
            <div style="font-family:system-ui;font-size:11px;line-height:1.6;padding:2px 4px">
              <div style="font-weight:700;margin-bottom:3px">Patch ${pId}</div>
              <div>True severe: <b>${cmp.actualSevere}</b> / ${cmp.total} buildings</div>
              <div>Pred. severe: <b>${cmp.predictedSevere}</b> / ${cmp.total} buildings</div>
              <div>Accuracy: <b>${cmp.accuracy.toFixed(1)}%</b></div>
            </div>
          `)
          .addTo(map)
      })
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
    }
  }, [mapReady, manifestMap, patches, actualPath, predictedPath, byPatch])

  // Toggle visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !layersReadyRef.current) return
    if (map.getLayer('damage-actual'))
      map.setLayoutProperty('damage-actual', 'visibility', showActual ? 'visible' : 'none')
    if (map.getLayer('path-actual'))
      map.setLayoutProperty('path-actual', 'visibility', showActual ? 'visible' : 'none')
    if (map.getLayer('path-actual-glow'))
      map.setLayoutProperty('path-actual-glow', 'visibility', showActual ? 'visible' : 'none')
  }, [showActual, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !layersReadyRef.current) return
    if (map.getLayer('damage-predicted'))
      map.setLayoutProperty('damage-predicted', 'visibility', showPredicted ? 'visible' : 'none')
    if (map.getLayer('path-predicted'))
      map.setLayoutProperty('path-predicted', 'visibility', showPredicted ? 'visible' : 'none')
    if (map.getLayer('path-predicted-glow'))
      map.setLayoutProperty('path-predicted-glow', 'visibility', showPredicted ? 'visible' : 'none')
  }, [showPredicted, mapReady])

  const maxDevKm = predictedFit.maxDevKm ?? 0

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">

      {/* Map */}
      <div className="relative w-full" style={{ height: 480 }}>
        <div ref={containerRef} className="absolute inset-0" />

        {/* Toggles */}
        <div className="absolute top-3 left-3 z-10 flex gap-2">
          <LayerToggle
            active={showActual}
            onClick={() => setShowActual(v => !v)}
            dotStyle="bg-emerald-400"
            lineStyle="solid border-emerald-400"
            label="Ground Truth"
          />
          <LayerToggle
            active={showPredicted}
            onClick={() => setShowPredicted(v => !v)}
            dotStyle="border-2 border-amber-400"
            lineStyle="dashed border-amber-400"
            label="Predicted"
          />
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-10 bg-black/75 backdrop-blur-sm rounded-lg px-3 py-2.5 border border-white/10 space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-white/50">Severe damage rate</div>
          <div className="flex items-center gap-1">
            {['#22c55e', '#facc15', '#f97316', '#a855f7'].map(c => (
              <div key={c} className="w-5 h-3 rounded-sm" style={{ background: c }} />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-white/40 -mt-1">
            <span>0%</span><span>100%</span>
          </div>
          <div className="border-t border-white/10 pt-2 space-y-1.5">
            <div className="flex items-center gap-2 text-[9px] text-white/50">
              <span className="w-4 h-3 rounded-sm bg-white/30 flex-shrink-0" />
              Filled = ground truth
            </div>
            <div className="flex items-center gap-2 text-[9px] text-white/50">
              <span className="w-4 h-3 rounded-sm border-2 border-white/40 flex-shrink-0" />
              Ring = predicted
            </div>
            <div className="flex items-center gap-2 text-[9px] text-white/50">
              <div className="w-4 h-0.5 bg-emerald-400 flex-shrink-0" />
              True damage path
            </div>
            <div className="flex items-center gap-2 text-[9px] text-white/50">
              <div className="w-4 border-t-2 border-dashed border-amber-400 flex-shrink-0" />
              Predicted path
            </div>
          </div>
        </div>

        {/* Path deviation badge */}
        {maxDevKm > 0 && (
          <div className="absolute top-3 right-12 z-10 bg-black/75 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10 text-[10px] text-right">
            <div className="text-white/50 uppercase tracking-widest">Max path deviation</div>
            <div className="text-white font-bold text-base">{maxDevKm} km</div>
          </div>
        )}
      </div>

      {/* Histogram below map */}
      <div className="border-t border-border px-5 pt-4 pb-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold">Severe Damage Along Corridor</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              True vs. predicted severe building count per km bin · quadratic path fitted to weighted centroids
            </p>
          </div>
          <div className="flex gap-4 text-[11px] text-muted-foreground flex-shrink-0">
            <Stat label="Path deviation" value={`${maxDevKm} km`} accent="text-amber-400" />
          </div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={histData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} interval={2} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
              formatter={(v: number, name: string) => [v, name === 'actual' ? 'Ground Truth' : 'Predicted']}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={n => n === 'actual' ? 'Ground Truth' : 'Predicted'} />
            <Bar dataKey="actual" fill="#34d399" radius={[2, 2, 0, 0]} fillOpacity={0.85} />
            <Bar dataKey="predicted" fill="#f59e0b" radius={[2, 2, 0, 0]} fillOpacity={0.85} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function LayerToggle({
  active, onClick, dotStyle, lineStyle, label,
}: {
  active: boolean
  onClick: () => void
  dotStyle: string
  lineStyle: string
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold backdrop-blur-sm border transition-all ${
        active ? 'bg-white/15 border-white/30 text-white' : 'bg-black/50 border-white/10 text-white/35'
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotStyle}`} />
      {label}
    </button>
  )
}

function Stat({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-bold ${accent}`}>{value}</div>
    </div>
  )
}
