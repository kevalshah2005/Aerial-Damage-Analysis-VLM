import fs from "fs"
import path from "path"

const MAX_SECTION_CHARS = 6000
const MAX_TOTAL_CHARS = 12000

function safeReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

function trimSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n... [truncated]`
}

function loadManifestSummary(contentDir: string): string | null {
  const manifestPath = path.join(contentDir, "manifest.json")
  const raw = safeReadFile(manifestPath)
  if (!raw) return null

  try {
    const manifest = JSON.parse(raw) as {
      count?: number
      patches?: Array<{ id?: string; buildingCount?: number }>
    }
    const count = manifest.count ?? manifest.patches?.length ?? 0
    const totalBuildings = (manifest.patches ?? []).reduce(
      (sum, patch) => sum + (patch.buildingCount ?? 0),
      0
    )
    const samplePatchIds = (manifest.patches ?? [])
      .slice(0, 10)
      .map((patch) => patch.id)
      .filter(Boolean)
      .join(", ")

    return [
      `Patch count: ${count}`,
      `Approximate building features (sum of per-patch max): ${totalBuildings}`,
      samplePatchIds ? `Sample patch IDs: ${samplePatchIds}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  } catch {
    return null
  }
}

function loadJsonContext(contentDir: string): string | null {
  const jsonPath = path.join(contentDir, "chat-context", "disaster_damages.json")
  const raw = safeReadFile(jsonPath)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    // Keep malformed JSON visible to help debugging, but do not crash chat.
    return raw
  }
}

function loadReferenceNotes(contentDir: string): string | null {
  const notesPath = path.join(contentDir, "chat-context", "reference_notes.md")
  const raw = safeReadFile(notesPath)
  if (!raw) return null
  return raw.trim()
}

export function buildChatDataContext(): string {
  const contentDir = path.join(process.cwd(), "content")
  const sections: string[] = []

  const manifestSummary = loadManifestSummary(contentDir)
  if (manifestSummary) {
    sections.push(
      [
        "### Local Dataset Manifest Summary",
        trimSection(manifestSummary, MAX_SECTION_CHARS),
      ].join("\n")
    )
  }

  const jsonContext = loadJsonContext(contentDir)
  if (jsonContext) {
    sections.push(
      [
        "### Disaster Damage Data (Local JSON)",
        trimSection(jsonContext, MAX_SECTION_CHARS),
      ].join("\n")
    )
  }

  const referenceNotes = loadReferenceNotes(contentDir)
  if (referenceNotes) {
    sections.push(
      [
        "### Curated External References (Local Notes)",
        trimSection(referenceNotes, MAX_SECTION_CHARS),
      ].join("\n")
    )
  }

  if (sections.length === 0) {
    return "No local disaster context files were found."
  }

  const combined = sections.join("\n\n")
  return trimSection(combined, MAX_TOTAL_CHARS)
}
