import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

function resolveDatasetImagesDir() {
  const root = process.env.DATASET_LOCAL_ROOT
  if (!root) {
    throw new Error("DATASET_LOCAL_ROOT is required for local dataset image routes")
  }

  if (!path.isAbsolute(root)) {
    throw new Error("DATASET_LOCAL_ROOT must be an absolute path")
  }

  return path.join(root, "images")
}

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
  let imagesDir = ""
  try {
    imagesDir = resolveDatasetImagesDir()
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
  const filePath = path.join(imagesDir, safeName)

  try {
    const relative = path.relative(imagesDir, filePath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 })
    }

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
