import { NextRequest, NextResponse } from "next/server"
import { loadAugmentedManifest } from "@/lib/dataset-manifest"

export async function GET(req: NextRequest) {
  try {
    const scaleXRaw = req.nextUrl.searchParams.get("scaleX")
    const scaleYRaw = req.nextUrl.searchParams.get("scaleY")
    const offsetLatRaw = req.nextUrl.searchParams.get("offsetLat")
    const offsetLngRaw = req.nextUrl.searchParams.get("offsetLng")
    const scaleX = scaleXRaw ? Number.parseFloat(scaleXRaw) : 1
    const scaleY = scaleYRaw ? Number.parseFloat(scaleYRaw) : 1
    const offsetLat = offsetLatRaw ? Number.parseFloat(offsetLatRaw) : undefined
    const offsetLng = offsetLngRaw ? Number.parseFloat(offsetLngRaw) : undefined
    const manifest = loadAugmentedManifest({
      scaleX: Number.isFinite(scaleX) ? scaleX : 1,
      scaleY: Number.isFinite(scaleY) ? scaleY : 1,
      ...(offsetLat !== undefined && Number.isFinite(offsetLat) ? { offsetLat } : {}),
      ...(offsetLng !== undefined && Number.isFinite(offsetLng) ? { offsetLng } : {}),
    })
    return NextResponse.json(
      manifest,
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  } catch {
    return NextResponse.json(
      { error: "Manifest not found. Run: python3 content/generate_manifest.py" },
      { status: 404 }
    )
  }
}
