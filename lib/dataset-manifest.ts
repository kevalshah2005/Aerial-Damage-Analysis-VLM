import fs from "fs"
import path from "path"

import type {
  DatasetBounds,
  DatasetImageCoordinates,
  DatasetManifest,
  DatasetPatch,
} from "@/lib/types"

const XVIEW_FOOTPRINT_WIDTH = 1126
const XVIEW_FOOTPRINT_HEIGHT = 902
const BLACK_TRANSPARENT_TILE_IDS = new Set([
  "00000105",
  "00000091",
  "00000140",
  "00000037",
  "00000095",
  "00000084",
  "00000131",
  "00000043",
  "00000005",
  "00000104",
  "00000045",
  "00000009",
  "00000013",
  "00000051",
])
const RIGHT_STRIP_SEAM_TILE_IDS = new Set([
  "00000091",
  "00000037",
  "00000084",
  "00000043",
  "00000104",
  "00000009",
  "00000051",
])
const RIGHT_STRIP_MIN_COLUMN = 5
const RIGHT_STRIP_MAX_OFFSET_DELTA = 0.18
const configuredOverlayOffsetLat = Number.parseFloat(process.env.DATASET_OVERLAY_OFFSET_LAT ?? "-0.00010")
const configuredOverlayOffsetLng = Number.parseFloat(process.env.DATASET_OVERLAY_OFFSET_LNG ?? "0.00002")
const DEFAULT_OVERLAY_OFFSET_LAT = Number.isFinite(configuredOverlayOffsetLat) ? configuredOverlayOffsetLat : -0.00010
const DEFAULT_OVERLAY_OFFSET_LNG = Number.isFinite(configuredOverlayOffsetLng) ? configuredOverlayOffsetLng : 0.00002

function extractFilename(value: string): string | null {
  if (!value) return null
  try {
    return path.basename(new URL(value).pathname)
  } catch {
    return path.basename(value)
  }
}

function getGeotransform(
  geotransforms: Record<string, [number[], string]>,
  imageUrl: string
): number[] | null {
  const filename = extractFilename(imageUrl)
  if (!filename) return null
  const direct = geotransforms[filename]?.[0]
  if (direct) return direct
  if (filename.endsWith(".webp")) {
    return geotransforms[filename.replace(/\.webp$/i, ".png")]?.[0] ?? null
  }
  return null
}

function calculateBoundsFromGeotransform(gt: number[], width: number, height: number): DatasetBounds {
  const [xmin, xres, , ymax, , yres] = gt
  const minLng = xmin
  const maxLng = xmin + width * xres
  const maxLat = ymax
  const minLat = ymax + height * yres
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ]
}

function mergeBounds(a: DatasetBounds, b: DatasetBounds): DatasetBounds {
  return [
    [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
    [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
  ]
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function boundsWidth(bounds: DatasetBounds): number {
  return bounds[1][1] - bounds[0][1]
}

function boundsHeight(bounds: DatasetBounds): number {
  return bounds[1][0] - bounds[0][0]
}

function boundsCenter(bounds: DatasetBounds): [number, number] {
  return [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ]
}

function imageCoordinatesToBounds(coordinates: DatasetImageCoordinates): DatasetBounds {
  const lons = coordinates.map(([lng]) => lng)
  const lats = coordinates.map(([, lat]) => lat)
  return [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)],
  ]
}

function translateCoordinates(
  coordinates: DatasetImageCoordinates,
  offsetLng: number,
  offsetLat: number
): DatasetImageCoordinates {
  return coordinates.map(([lng, lat]) => [lng + offsetLng, lat + offsetLat]) as DatasetImageCoordinates
}

function boundsToImageCoordinates(bounds: DatasetBounds): DatasetImageCoordinates {
  return [
    [bounds[0][1], bounds[1][0]],
    [bounds[1][1], bounds[1][0]],
    [bounds[1][1], bounds[0][0]],
    [bounds[0][1], bounds[0][0]],
  ]
}

function addPoint(
  a: [number, number],
  b: [number, number]
): [number, number] {
  return [a[0] + b[0], a[1] + b[1]]
}

function scalePoint(
  point: [number, number],
  scale: number
): [number, number] {
  return [point[0] * scale, point[1] * scale]
}

function latticeCoordinates(
  anchorNorthWest: [number, number],
  eastVector: [number, number],
  southVector: [number, number],
  col: number,
  row: number
): DatasetImageCoordinates {
  const origin = addPoint(
    addPoint(anchorNorthWest, scalePoint(eastVector, col)),
    scalePoint(southVector, row)
  )
  const northEast = addPoint(origin, eastVector)
  const southWest = addPoint(origin, southVector)
  const southEast = addPoint(northEast, southVector)
  return [origin, northEast, southEast, southWest]
}

function getDisplayImageUrl(id: string, layer: "pre" | "post", originalUrl: string): string {
  if (!BLACK_TRANSPARENT_TILE_IDS.has(id)) return originalUrl
  return `/api/dataset/image/masked/${layer}/${id}`
}

function solveLatticeCell(
  deltaLng: number,
  deltaLat: number,
  eastVector: [number, number],
  southVector: [number, number]
): [number, number] | null {
  const det = eastVector[0] * southVector[1] - southVector[0] * eastVector[1]
  if (Math.abs(det) < 1e-12) return null
  return [
    (deltaLng * southVector[1] - southVector[0] * deltaLat) / det,
    (eastVector[0] * deltaLat - deltaLng * eastVector[1]) / det,
  ]
}

function estimateLatticeVectors(
  patches: DatasetPatch[],
  sourceWidth: number,
  sourceHeight: number
): { east: [number, number]; south: [number, number] } {
  const centers = patches.map((patch) =>
    boundsCenter(patch.preBounds ?? patch.displayBounds ?? patch.bounds)
  )
  const eastCandidates: [number, number][] = []
  const southCandidates: [number, number][] = []

  for (let i = 0; i < centers.length; i++) {
    const [aLat, aLng] = centers[i]
    for (let j = 0; j < centers.length; j++) {
      if (i === j) continue
      const [bLat, bLng] = centers[j]
      const dLng = bLng - aLng
      const dLat = bLat - aLat
      if (
        dLng > sourceWidth * 0.45 &&
        dLng < sourceWidth * 1.8 &&
        Math.abs(dLat) < sourceHeight * 0.35
      ) {
        eastCandidates.push([dLng, dLat])
      }
      if (
        dLat < -sourceHeight * 0.45 &&
        dLat > -sourceHeight * 1.8 &&
        Math.abs(dLng) < sourceWidth * 0.35
      ) {
        southCandidates.push([dLng, dLat])
      }
    }
  }

  const eastLng = median(eastCandidates.map(([lng]) => lng)) || sourceWidth
  const eastLat = median(eastCandidates.map(([, lat]) => lat))
  const southLng = median(southCandidates.map(([lng]) => lng))
  const southLat = median(southCandidates.map(([, lat]) => lat)) || -sourceHeight

  return {
    east: [eastLng, eastLat],
    south: [southLng, southLat],
  }
}

function snapPatchBounds(
  patches: DatasetPatch[],
  scaleX: number,
  scaleY: number
): DatasetPatch[] {
  if (!patches.length) return patches

  const sourceBounds = patches.map((patch) => patch.preBounds ?? patch.displayBounds ?? patch.bounds)
  const sourceWidth = median(sourceBounds.map(boundsWidth))
  const sourceHeight = median(sourceBounds.map(boundsHeight))
  const anchorPatch = patches.find((patch) => patch.id === "00000000") ?? patches[0]
  const anchorCell = anchorPatch.preBounds ?? anchorPatch.displayBounds ?? anchorPatch.bounds
  const [anchorLat, anchorLng] = boundsCenter(anchorCell)

  const lattice = estimateLatticeVectors(patches, sourceWidth, sourceHeight)
  const anchorNorthWest: [number, number] = [anchorCell[0][1], anchorCell[1][0]]
  const scaledEast = scalePoint(lattice.east, scaleX)
  const scaledSouth = scalePoint(lattice.south, scaleY)

  const assignments = patches.map((patch) => {
    const source = patch.preBounds ?? patch.displayBounds ?? patch.bounds
    const [lat, lng] = boundsCenter(source)
    const solved = solveLatticeCell(lng - anchorLng, lat - anchorLat, lattice.east, lattice.south)
    const colFloat = solved?.[0] ?? Math.round((lng - anchorLng) / sourceWidth)
    const rowFloat = solved?.[1] ?? Math.round((anchorLat - lat) / sourceHeight)
    const col = Math.round(colFloat)
    const row = Math.round(rowFloat)
    const colOffset = colFloat - col
    const rowOffset = rowFloat - row
    const residual = Math.hypot(
      colOffset * sourceWidth,
      rowOffset * sourceHeight
    )
    return { patch, col, row, colOffset, rowOffset, residual }
  })

  const rightStripSeamAssignments = assignments.filter(({ patch }) =>
    RIGHT_STRIP_SEAM_TILE_IDS.has(patch.id)
  )
  const rightStripColOffset = median(rightStripSeamAssignments.map(({ colOffset }) => colOffset))
  const rightStripRowOffset = median(rightStripSeamAssignments.map(({ rowOffset }) => rowOffset))

  const stripAssignments = assignments.map((assignment) => {
    const matchesRightStripOffset =
      assignment.col >= RIGHT_STRIP_MIN_COLUMN &&
      Math.abs(assignment.colOffset - rightStripColOffset) <= RIGHT_STRIP_MAX_OFFSET_DELTA &&
      Math.abs(assignment.rowOffset - rightStripRowOffset) <= RIGHT_STRIP_MAX_OFFSET_DELTA
    return {
      ...assignment,
      strip: matchesRightStripOffset ? "right" : "left",
    } as const
  })

  const bestByCell = new Map<string, (typeof stripAssignments)[number]>()
  for (const assignment of stripAssignments) {
    const key = `${assignment.strip}:${assignment.col}:${assignment.row}`
    const current = bestByCell.get(key)
    const currentIsAnchor = current?.patch.id === anchorPatch.id && current.col === 0 && current.row === 0
    const assignmentIsAnchor = assignment.patch.id === anchorPatch.id && assignment.col === 0 && assignment.row === 0
    const isBetter =
      !current ||
      assignmentIsAnchor ||
      (!currentIsAnchor &&
        (assignment.residual < current.residual ||
          (Math.abs(assignment.residual - current.residual) < 1e-12 &&
            assignment.patch.id < current.patch.id)))
    if (isBetter) bestByCell.set(key, assignment)
  }

  const keptPatchIds = new Set([...bestByCell.values()].map(({ patch }) => patch.id))

  return stripAssignments.filter(({ patch }) => keptPatchIds.has(patch.id)).map(({ patch, col, row, strip }) => {
    const coordinateCol = strip === "right" ? col + rightStripColOffset : col
    const coordinateRow = strip === "right" ? row + rightStripRowOffset : row
    const snappedCoordinates = latticeCoordinates(anchorNorthWest, scaledEast, scaledSouth, coordinateCol, coordinateRow)
    const snappedBounds = imageCoordinatesToBounds(snappedCoordinates)

    return {
      ...patch,
      snappedPreBounds: snappedBounds,
      snappedPostBounds: snappedBounds,
      snappedDisplayBounds: snappedBounds,
      snappedPreCoordinates: snappedCoordinates,
      snappedPostCoordinates: snappedCoordinates,
      snappedDisplayCoordinates: snappedCoordinates,
    }
  })
}

export function getPatchLayerBounds(patch: DatasetPatch, layer: "pre" | "post"): DatasetBounds {
  if (layer === "pre") return patch.snappedPreBounds ?? patch.preBounds ?? patch.displayBounds ?? patch.bounds
  return patch.snappedPostBounds ?? patch.postBounds ?? patch.displayBounds ?? patch.bounds
}

export function loadAugmentedManifest(
  options?: { scaleX?: number; scaleY?: number; offsetLat?: number; offsetLng?: number }
): DatasetManifest {
  const manifestPath = path.join(process.cwd(), "content", "manifest.json")
  const geotransformsPath = path.join(process.cwd(), "content", "xview_geotransforms.json")

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as DatasetManifest
  const geotransforms = fs.existsSync(geotransformsPath)
    ? (JSON.parse(fs.readFileSync(geotransformsPath, "utf-8")) as Record<string, [number[], string]>)
    : {}

  const patches = (manifest.patches ?? []).map((patch) => {
    const preGt = getGeotransform(geotransforms, patch.pre)
    const postGt = getGeotransform(geotransforms, patch.post)
    const preBounds = preGt
      ? calculateBoundsFromGeotransform(preGt, XVIEW_FOOTPRINT_WIDTH, XVIEW_FOOTPRINT_HEIGHT)
      : patch.preBounds ?? patch.bounds
    const postBounds = postGt
      ? calculateBoundsFromGeotransform(postGt, XVIEW_FOOTPRINT_WIDTH, XVIEW_FOOTPRINT_HEIGHT)
      : patch.postBounds ?? patch.bounds
    const displayBounds = mergeBounds(preBounds, postBounds)

    // Derive predicted labels URL by swapping the labels path prefix
    const predictedJson = patch.postJson
      ? patch.postJson.replace(/\/labels\//, "/generated_labels/")
      : undefined

    return {
      ...patch,
      pre: getDisplayImageUrl(patch.id, "pre", patch.pre),
      post: getDisplayImageUrl(patch.id, "post", patch.post),
      preBounds,
      postBounds,
      displayBounds,
      ...(predictedJson ? { predictedJson } : {}),
    }
  })

  const snappedPatches = snapPatchBounds(
    patches,
    options?.scaleX ?? 1,
    options?.scaleY ?? 1
  ).map((patch) => {
    const offsetLat = options?.offsetLat ?? DEFAULT_OVERLAY_OFFSET_LAT
    const offsetLng = options?.offsetLng ?? DEFAULT_OVERLAY_OFFSET_LNG
    const displayCoordinates = patch.snappedDisplayCoordinates ?? boundsToImageCoordinates(patch.snappedDisplayBounds ?? patch.displayBounds ?? patch.bounds)
    const preCoordinates = patch.snappedPreCoordinates ?? boundsToImageCoordinates(patch.snappedPreBounds ?? patch.preBounds ?? patch.bounds)
    const postCoordinates = patch.snappedPostCoordinates ?? boundsToImageCoordinates(patch.snappedPostBounds ?? patch.postBounds ?? patch.bounds)
    const translatedDisplayCoordinates = translateCoordinates(displayCoordinates, offsetLng, offsetLat)
    const translatedPreCoordinates = translateCoordinates(preCoordinates, offsetLng, offsetLat)
    const translatedPostCoordinates = translateCoordinates(postCoordinates, offsetLng, offsetLat)

    return {
      ...patch,
      snappedPreBounds: imageCoordinatesToBounds(translatedPreCoordinates),
      snappedPostBounds: imageCoordinatesToBounds(translatedPostCoordinates),
      snappedDisplayBounds: imageCoordinatesToBounds(translatedDisplayCoordinates),
      snappedPreCoordinates: translatedPreCoordinates,
      snappedPostCoordinates: translatedPostCoordinates,
      snappedDisplayCoordinates: translatedDisplayCoordinates,
    }
  })
  const snappedTotalBounds = snappedPatches.reduce<DatasetBounds | null>((acc, patch) => {
    const bounds = patch.snappedDisplayBounds ?? patch.displayBounds ?? patch.bounds
    return acc ? mergeBounds(acc, bounds) : bounds
  }, null)

  return {
    ...manifest,
    patches: snappedPatches,
    count: snappedPatches.length,
    totalBounds: snappedTotalBounds ?? manifest.totalBounds,
  }
}
