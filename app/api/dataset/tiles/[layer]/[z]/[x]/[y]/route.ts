import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"

import { getPatchLayerBounds, loadAugmentedManifest } from "@/lib/dataset-manifest"

export const runtime = "nodejs"

const TILE_SIZE = 256
const MERCATOR_MAX_LAT = 85.05112878

const imageCache = new Map<string, Promise<Buffer>>()

function clampLat(lat: number): number {
  return Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat))
}

function worldPixelX(lon: number, z: number): number {
  const scale = TILE_SIZE * 2 ** z
  return ((lon + 180) / 360) * scale
}

function worldPixelY(lat: number, z: number): number {
  const clamped = clampLat(lat)
  const rad = (clamped * Math.PI) / 180
  const scale = TILE_SIZE * 2 ** z
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale
}

function intersects(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY
}

async function getImageBuffer(url: string): Promise<Buffer> {
  let pending = imageCache.get(url)
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch source image: ${res.status}`)
      }
      return Buffer.from(await res.arrayBuffer())
    })
    imageCache.set(url, pending)
  }
  return pending
}

function parsePositiveInt(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ layer: string; z: string; x: string; y: string }> }
) {
  const { layer, z: zRaw, x: xRaw, y: yRaw } = await params
  const yClean = yRaw.replace(/\.png$/i, "")

  if (layer !== "pre" && layer !== "post") {
    return NextResponse.json({ error: "Layer must be pre or post" }, { status: 400 })
  }

  const z = parsePositiveInt(zRaw)
  const x = parsePositiveInt(xRaw)
  const y = parsePositiveInt(yClean)
  if (z === null || x === null || y === null) {
    return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400 })
  }

  try {
    const manifest = loadAugmentedManifest()
    const tileMinX = x * TILE_SIZE
    const tileMinY = y * TILE_SIZE
    const tileRect = {
      minX: tileMinX,
      minY: tileMinY,
      maxX: tileMinX + TILE_SIZE,
      maxY: tileMinY + TILE_SIZE,
    }

    const overlays: sharp.OverlayOptions[] = []

    for (const patch of manifest.patches) {
      const bounds = getPatchLayerBounds(patch, layer)
      const [[south, west], [north, east]] = bounds
      const patchRect = {
        minX: worldPixelX(west, z),
        minY: worldPixelY(north, z),
        maxX: worldPixelX(east, z),
        maxY: worldPixelY(south, z),
      }

      if (!intersects(tileRect, patchRect)) continue

      const intersectMinX = Math.max(tileRect.minX, patchRect.minX)
      const intersectMinY = Math.max(tileRect.minY, patchRect.minY)
      const intersectMaxX = Math.min(tileRect.maxX, patchRect.maxX)
      const intersectMaxY = Math.min(tileRect.maxY, patchRect.maxY)

      const destWidth = Math.max(1, Math.ceil(intersectMaxX - intersectMinX))
      const destHeight = Math.max(1, Math.ceil(intersectMaxY - intersectMinY))
      const destLeft = Math.floor(intersectMinX - tileRect.minX)
      const destTop = Math.floor(intersectMinY - tileRect.minY)

      const sourceBuffer = await getImageBuffer(layer === "pre" ? patch.pre : patch.post)
      const source = sharp(sourceBuffer, { animated: false })
      const metadata = await source.metadata()
      const sourceWidth = metadata.width ?? 1024
      const sourceHeight = metadata.height ?? 1024
      const patchWidthPx = Math.max(1, patchRect.maxX - patchRect.minX)
      const patchHeightPx = Math.max(1, patchRect.maxY - patchRect.minY)

      const cropLeft = Math.max(0, Math.floor(((intersectMinX - patchRect.minX) / patchWidthPx) * sourceWidth))
      const cropTop = Math.max(0, Math.floor(((intersectMinY - patchRect.minY) / patchHeightPx) * sourceHeight))
      const cropWidth = Math.min(
        sourceWidth - cropLeft,
        Math.max(1, Math.ceil(((intersectMaxX - intersectMinX) / patchWidthPx) * sourceWidth))
      )
      const cropHeight = Math.min(
        sourceHeight - cropTop,
        Math.max(1, Math.ceil(((intersectMaxY - intersectMinY) / patchHeightPx) * sourceHeight))
      )

      const patchTileBuffer = await sharp(sourceBuffer)
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .resize(destWidth, destHeight, { fit: "fill" })
        .png()
        .toBuffer()

      overlays.push({
        input: patchTileBuffer,
        left: Math.max(0, destLeft),
        top: Math.max(0, destTop),
      })
    }

    const tile = sharp({
      create: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })

    const output = await (overlays.length ? tile.composite(overlays) : tile).png().toBuffer()

    return new NextResponse(output, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Tile generation failed" },
      { status: 500 }
    )
  }
}
