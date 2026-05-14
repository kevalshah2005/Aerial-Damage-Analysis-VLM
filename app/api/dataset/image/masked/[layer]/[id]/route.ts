import fs from "fs"
import path from "path"

import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"

import type { DatasetManifest } from "@/lib/types"

export const runtime = "nodejs"

const DEFAULT_BLACK_THRESHOLD = 5
const processedImageCache = new Map<string, Promise<Buffer>>()

function parseThreshold(value: string | null): number {
  if (!value) return DEFAULT_BLACK_THRESHOLD
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_BLACK_THRESHOLD
  return Math.max(0, Math.min(32, parsed))
}

function getSourceImageUrl(id: string, layer: "pre" | "post"): string | null {
  const manifestPath = path.join(process.cwd(), "content", "manifest.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as DatasetManifest
  const patch = manifest.patches.find((candidate) => candidate.id === id)
  if (!patch) return null
  return layer === "pre" ? patch.pre : patch.post
}

async function fetchImage(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch source image: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function maskBlackToTransparent(url: string, threshold: number): Promise<Buffer> {
  const key = `${url}:${threshold}`
  let pending = processedImageCache.get(key)
  if (!pending) {
    pending = (async () => {
      const source = await fetchImage(url)
      const image = sharp(source, { animated: false }).ensureAlpha()
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })

      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] <= threshold && data[i + 1] <= threshold && data[i + 2] <= threshold) {
          data[i + 3] = 0
        }
      }

      return sharp(data, {
        raw: {
          width: info.width,
          height: info.height,
          channels: info.channels,
        },
      }).png().toBuffer()
    })().catch((error) => {
      processedImageCache.delete(key)
      throw error
    })
    processedImageCache.set(key, pending)
  }
  return pending
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ layer: string; id: string }> }
) {
  const { layer: layerRaw, id } = await params
  if (layerRaw !== "pre" && layerRaw !== "post") {
    return NextResponse.json({ error: "Layer must be pre or post" }, { status: 400 })
  }

  const sourceUrl = getSourceImageUrl(id, layerRaw)
  if (!sourceUrl) {
    return NextResponse.json({ error: "Patch not found" }, { status: 404 })
  }

  try {
    const output = await maskBlackToTransparent(sourceUrl, parseThreshold(req.nextUrl.searchParams.get("threshold")))
    return new NextResponse(output, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Image processing failed" },
      { status: 502 }
    )
  }
}
