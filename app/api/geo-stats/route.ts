import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

interface ManifestPatch {
  id: string
  pre: string
  post: string
  bounds: [[number, number], [number, number]]
  buildingCount: number
}

function weightedPCA(points: { lat: number; lon: number; w: number }[]) {
  const W = points.reduce((s, p) => s + p.w, 0)
  const cLat = points.reduce((s, p) => s + p.lat * p.w, 0) / W
  const cLon = points.reduce((s, p) => s + p.lon * p.w, 0) / W

  let cLL = 0, cLA = 0, cAA = 0
  for (const p of points) {
    const dl = p.lat - cLat
    const da = p.lon - cLon
    cLL += p.w * dl * dl
    cLA += p.w * dl * da
    cAA += p.w * da * da
  }
  cLL /= W; cLA /= W; cAA /= W

  const tr = cLL + cAA
  const disc = Math.sqrt(Math.max(0, (tr / 2) ** 2 - (cLL * cAA - cLA * cLA)))
  const lambda1 = tr / 2 + disc
  const lambda2 = tr / 2 - disc

  // Eigenvector for lambda1: [lambda1 - cAA, cLA]
  let eLat = lambda1 - cAA
  let eLon = cLA
  const eLen = Math.sqrt(eLat * eLat + eLon * eLon) || 1
  eLat /= eLen
  eLon /= eLen

  return {
    center: { lat: cLat, lon: cLon },
    axis: { lat: eLat, lon: eLon },
    spread1: Math.sqrt(Math.max(0, lambda1)),
    spread2: Math.sqrt(Math.max(0, lambda2)),
  }
}

export async function GET() {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'content', 'manifest.json'), 'utf-8'))

  const patches = (manifest.patches as ManifestPatch[]).map(p => ({
    id: p.id,
    centroid: {
      lat: (p.bounds[0][0] + p.bounds[1][0]) / 2,
      lon: (p.bounds[0][1] + p.bounds[1][1]) / 2,
    },
    buildingCount: p.buildingCount,
  }))

  const totalBuildings = patches.reduce((s, p) => s + p.buildingCount, 0)
  const maxBuildings = Math.max(...patches.map(p => p.buildingCount))

  const pca = weightedPCA(patches.map(p => ({ lat: p.centroid.lat, lon: p.centroid.lon, w: p.buildingCount })))

  // Project each patch centroid onto the principal axis
  const projections = patches.map(p => {
    const dl = p.centroid.lat - pca.center.lat
    const da = p.centroid.lon - pca.center.lon
    return dl * pca.axis.lat + da * pca.axis.lon
  })

  const minP = Math.min(...projections)
  const maxP = Math.max(...projections)
  const halfLen = (maxP - minP) / 2

  // Shift corridor center to the weighted midpoint of projections
  const midP = (minP + maxP) / 2
  const corridorCenter = {
    lat: pca.center.lat + midP * pca.axis.lat,
    lon: pca.center.lon + midP * pca.axis.lon,
  }

  // Corridor half-width: 1.5 standard deviations perpendicular
  const halfWidth = pca.spread2 * 1.5
  const perp = { lat: -pca.axis.lon, lon: pca.axis.lat }

  const corners: [number, number][] = [
    [corridorCenter.lat + halfLen * pca.axis.lat + halfWidth * perp.lat, corridorCenter.lon + halfLen * pca.axis.lon + halfWidth * perp.lon],
    [corridorCenter.lat + halfLen * pca.axis.lat - halfWidth * perp.lat, corridorCenter.lon + halfLen * pca.axis.lon - halfWidth * perp.lon],
    [corridorCenter.lat - halfLen * pca.axis.lat - halfWidth * perp.lat, corridorCenter.lon - halfLen * pca.axis.lon - halfWidth * perp.lon],
    [corridorCenter.lat - halfLen * pca.axis.lat + halfWidth * perp.lat, corridorCenter.lon - halfLen * pca.axis.lon + halfWidth * perp.lon],
  ]

  // Axis endpoints for rendering
  const axisStart: [number, number] = [
    corridorCenter.lat - halfLen * pca.axis.lat,
    corridorCenter.lon - halfLen * pca.axis.lon,
  ]
  const axisEnd: [number, number] = [
    corridorCenter.lat + halfLen * pca.axis.lat,
    corridorCenter.lon + halfLen * pca.axis.lon,
  ]

  // Convert to km (approximate, Houston ~30°N)
  const cosLat = Math.cos(pca.center.lat * Math.PI / 180)
  const KM = 111
  const corridorLengthKm = Math.sqrt(
    (halfLen * 2 * pca.axis.lat * KM) ** 2 +
    (halfLen * 2 * pca.axis.lon * cosLat * KM) ** 2
  )
  const corridorWidthKm = halfWidth * 2 * KM

  // Bearing from north, clockwise
  const bearingRad = Math.atan2(pca.axis.lon * cosLat, pca.axis.lat)
  const bearingDeg = ((bearingRad * 180 / Math.PI) + 360) % 360

  // Affected area (bounding box)
  const allLats = (manifest.patches as ManifestPatch[]).flatMap(p => [p.bounds[0][0], p.bounds[1][0]])
  const allLons = (manifest.patches as ManifestPatch[]).flatMap(p => [p.bounds[0][1], p.bounds[1][1]])
  const affectedAreaKm2 =
    (Math.max(...allLats) - Math.min(...allLats)) * KM *
    (Math.max(...allLons) - Math.min(...allLons)) * cosLat * KM

  // Damage profile: 20 bins along corridor axis
  const NUM_BINS = 20
  const bins = Array.from({ length: NUM_BINS }, (_, i) => ({
    positionKm: Math.round(((i + 0.5) / NUM_BINS) * corridorLengthKm * 10) / 10,
    buildings: 0,
  }))
  patches.forEach((p, i) => {
    const norm = (projections[i] - minP) / (maxP - minP)
    const bin = Math.min(NUM_BINS - 1, Math.floor(norm * NUM_BINS))
    bins[bin].buildings += p.buildingCount
  })

  return NextResponse.json({
    patches: patches.map((p, i) => ({ ...p, projection: projections[i] })),
    corridor: {
      center: corridorCenter,
      corners,
      axisStart,
      axisEnd,
      lengthKm: Math.round(corridorLengthKm),
      widthKm: Math.round(corridorWidthKm),
      bearingDeg: Math.round(bearingDeg),
    },
    stats: {
      totalBuildings,
      maxBuildings,
      totalPatches: patches.length,
      affectedAreaKm2: Math.round(affectedAreaKm2),
    },
    profile: bins,
  })
}
