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
      totalBounds?: [[number, number], [number, number]]
      patches?: Array<{ id?: string; buildingCount?: number; bounds?: unknown }>
    }
    const count = manifest.count ?? manifest.patches?.length ?? 0
    const totalBuildings = (manifest.patches ?? []).reduce(
      (sum, patch) => sum + (patch.buildingCount ?? 0),
      0
    )

    return [
      `Patch count: ${count}`,
      `Total buildings: ${totalBuildings}`,
      manifest.totalBounds ? `Geographic extent: SW ${manifest.totalBounds[0].join(", ")} — NE ${manifest.totalBounds[1].join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  } catch {
    return null
  }
}

function loadPatchSummaries(contentDir: string): string | null {
  const summariesPath = path.join(contentDir, "chat-context", "predicted_patch_summaries.json")
  const raw = safeReadFile(summariesPath)
  if (!raw) return null

  try {
    type PatchSummary = {
      id: string
      bounds: [[number, number], [number, number]]
      buildingCount: number
      damage: Record<string, number>
    }
    const patches = JSON.parse(raw) as PatchSummary[]

    // Top 10 by destroyed count
    const byDestroyed = [...patches]
      .sort((a, b) => (b.damage["destroyed"] ?? 0) - (a.damage["destroyed"] ?? 0))
      .slice(0, 10)

    // Top 10 by total severe (major + destroyed)
    const bySevere = [...patches]
      .sort((a, b) => {
        const sa = (b.damage["destroyed"] ?? 0) + (b.damage["major-damage"] ?? 0)
        const sb = (a.damage["destroyed"] ?? 0) + (a.damage["major-damage"] ?? 0)
        return sa - sb
      })
      .slice(0, 10)

    const fmt = (p: PatchSummary) => {
      const d = p.damage
      const center = [
        ((p.bounds[0][0] + p.bounds[1][0]) / 2).toFixed(5),
        ((p.bounds[0][1] + p.bounds[1][1]) / 2).toFixed(5),
      ].join(", ")
      return `  patch ${p.id} (center ${center}): destroyed=${d["destroyed"] ?? 0}, major=${d["major-damage"] ?? 0}, minor=${d["minor-damage"] ?? 0}, none=${d["no-damage"] ?? 0}`
    }

    return [
      `Total patches with per-building data: ${patches.length}`,
      "",
      "Top 10 patches by destroyed building count:",
      byDestroyed.map(fmt).join("\n"),
      "",
      "Top 10 patches by severe damage (major + destroyed):",
      bySevere.map(fmt).join("\n"),
    ].join("\n")
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

  const patchSummaries = loadPatchSummaries(contentDir)
  if (patchSummaries) {
    sections.push(
      [
        "### Per-Patch Damage Summaries (Model Predictions)",
        trimSection(patchSummaries, MAX_SECTION_CHARS),
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
