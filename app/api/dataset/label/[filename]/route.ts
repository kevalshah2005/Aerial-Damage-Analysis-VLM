import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

function resolveDatasetLabelsDir() {
  const root = process.env.DATASET_LOCAL_ROOT
  if (!root) {
    throw new Error("DATASET_LOCAL_ROOT is required for local dataset label routes")
  }

  if (!path.isAbsolute(root)) {
    throw new Error("DATASET_LOCAL_ROOT must be an absolute path")
  }

  return path.join(root, "labels")
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  if (!filename.endsWith(".json")) {
    return NextResponse.json({ error: "Only JSON files allowed" }, { status: 400 })
  }

  const safeName = path.basename(filename)
  let labelsDir = ""
  try {
    labelsDir = resolveDatasetLabelsDir()
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
  const filePath = path.join(labelsDir, safeName)

  try {
    const relative = path.relative(labelsDir, filePath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 })
    }

    const data = fs.readFileSync(filePath, "utf-8")
    return NextResponse.json(JSON.parse(data), {
      headers: {
        "Cache-Control": "public, max-age=86400, immutable",
      },
    })
  } catch {
    return NextResponse.json({ error: "Label not found" }, { status: 404 })
  }
}
