import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export async function GET() {
  const manifestPath = path.join(process.cwd(), "content", "manifest.json")

  try {
    const data = fs.readFileSync(manifestPath, "utf-8")
    const manifest = JSON.parse(data)
    return NextResponse.json(manifest, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    })
  } catch {
    return NextResponse.json(
      { error: "Manifest not found. Run: python3 content/generate_manifest.py" },
      { status: 404 }
    )
  }
}
