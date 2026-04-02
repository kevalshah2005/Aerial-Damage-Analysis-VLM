import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  if (!filename.endsWith(".json")) {
    return NextResponse.json({ error: "Only JSON files allowed" }, { status: 400 })
  }

  const safeName = path.basename(filename)
  const filePath = path.join(process.cwd(), "content", "harvey-geo", "labels", safeName)

  try {
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
