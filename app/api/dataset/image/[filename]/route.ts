import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  if (!filename.endsWith(".png")) {
    return NextResponse.json({ error: "Only PNG files allowed" }, { status: 400 })
  }

  // Sanitize filename to prevent path traversal
  const safeName = path.basename(filename)
  const filePath = path.join(process.cwd(), "content", "harvey-geo", "images", safeName)

  try {
    const stat = fs.statSync(filePath)
    const fileStream = fs.createReadStream(filePath)

    return new NextResponse(fileStream as any, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": stat.size.toString(),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    })
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 })
  }
}
