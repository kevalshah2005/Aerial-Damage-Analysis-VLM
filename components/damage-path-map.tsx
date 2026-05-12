'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polygon, Polyline, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface Patch {
  id: string
  centroid: { lat: number; lon: number }
  buildingCount: number
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
  patches: Patch[]
  corridor: Corridor
  maxBuildings: number
}

function buildingColor(count: number, max: number): string {
  const t = count / max
  // green → yellow → red
  const hue = Math.round(120 * (1 - t))
  return `hsl(${hue}, 80%, 45%)`
}

function buildingRadius(count: number, max: number): number {
  return 3 + (count / max) * 9
}

export default function DamagePathMap({ patches, corridor, maxBuildings }: Props) {
  const centerLat = corridor.center.lat
  const centerLon = corridor.center.lon

  return (
    <div className="relative w-full h-[420px] rounded-lg overflow-hidden border border-border">
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={11}
        style={{ height: '100%', width: '100%', background: '#0c1117' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />

        {/* Damage corridor polygon */}
        <Polygon
          positions={corridor.corners as [number, number][]}
          pathOptions={{
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.15,
            weight: 2,
            opacity: 0.7,
            dashArray: '6 4',
          }}
        />

        {/* Principal axis line */}
        <Polyline
          positions={[corridor.axisStart, corridor.axisEnd]}
          pathOptions={{ color: '#fbbf24', weight: 2, opacity: 0.9, dashArray: '8 4' }}
        />

        {/* Patch centroids */}
        {patches.map(p => (
          <CircleMarker
            key={p.id}
            center={[p.centroid.lat, p.centroid.lon]}
            radius={buildingRadius(p.buildingCount, maxBuildings)}
            pathOptions={{
              color: buildingColor(p.buildingCount, maxBuildings),
              fillColor: buildingColor(p.buildingCount, maxBuildings),
              fillOpacity: 0.75,
              weight: 0,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <span className="text-xs">
                Patch {p.id} · {p.buildingCount} buildings
              </span>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 text-[10px] space-y-1.5 border border-white/10">
        <div className="text-white/60 font-medium uppercase tracking-widest">Building Density</div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {['#44a455', '#8ab844', '#d4c324', '#e07a22', '#c83232'].map(c => (
              <div key={c} className="w-4 h-2.5 rounded-sm" style={{ background: c }} />
            ))}
          </div>
          <div className="flex justify-between w-full text-white/50">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <div className="w-6 border-t-2 border-dashed border-amber-400/80" />
          <span className="text-amber-300/80">Damage corridor</span>
        </div>
      </div>
    </div>
  )
}
