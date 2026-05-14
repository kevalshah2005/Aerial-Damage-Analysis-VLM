import { NextResponse } from 'next/server'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'

const LABELS = ['No Damage', 'Minor Damage', 'Major Damage', 'Destroyed'] as const
type Label = typeof LABELS[number]

const MODEL_NAMES: Record<string, string> = {
  'amazon.nova-pro-v1:0': 'Nova Pro',
  'google.gemma-3-12b-it': 'Gemma 3 12B',
  'qwen.qwen3-vl-235b-a22b': 'Qwen3 VL 235B',
}

function parsePct(v: string | number): number {
  if (typeof v === 'number') return Math.round(v * 1000) / 10 // 0.92 → 92.0
  return parseFloat(v.replace('%', ''))
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeBenchmarkModel(m: Record<string, unknown>) {
  const cm = m.confusionMatrix as Record<Label, Record<Label, number>>
  const raw = m.classMetrics as Record<Label, { precision: string; recall: string; f1: string }> | undefined
  if (!raw || !cm) {
    return normalizePipelineModel(m, [])
  }
  const totalSamples = LABELS.reduce((s, a) =>
    s + LABELS.reduce((ss, p) => ss + (cm[a]?.[p] ?? 0), 0), 0)
  const classMetrics = Object.fromEntries(LABELS.map(cls => [cls, {
    precision: parsePct(raw[cls]?.precision ?? 0),
    recall: parsePct(raw[cls]?.recall ?? 0),
    f1: parsePct(raw[cls]?.f1 ?? 0),
    support: LABELS.reduce((s, p) => s + (cm[cls]?.[p] ?? 0), 0),
  }])) as Record<Label, { precision: number; recall: number; f1: number; support: number }>
  const correct = LABELS.reduce((s, cls) => s + (cm[cls]?.[cls] ?? 0), 0)
  const accuracy = totalSamples > 0 ? Math.round((correct / totalSamples) * 1000) / 10 : 0
  const macroF1 = Math.round(LABELS.reduce((s, cls) => s + classMetrics[cls].f1, 0) / LABELS.length * 10) / 10
  return { accuracy, macroF1, weightedF1: accuracy, totalSamples, classMetrics, confusionMatrix: cm }
}

function normalizePipelineModel(m: Record<string, unknown>, details: Detail[]) {
  const classMetrics = Object.fromEntries(LABELS.map(cls => {
    const c = (m[cls] ?? {}) as { precision?: number; recall?: number; 'f1-score'?: number; support?: number }
    return [cls, {
      precision: Math.round((c.precision ?? 0) * 1000) / 10,
      recall: Math.round((c.recall ?? 0) * 1000) / 10,
      f1: Math.round((c['f1-score'] ?? 0) * 1000) / 10,
      support: c.support ?? 0,
    }]
  })) as Record<Label, { precision: number; recall: number; f1: number; support: number }>

  const confusionMatrix = Object.fromEntries(
    LABELS.map(a => [a, Object.fromEntries(LABELS.map(p => [p, 0]))])
  ) as Record<Label, Record<Label, number>>
  for (const d of details) {
    const a = d.actual_label as Label, p = d.predicted_label as Label
    if (confusionMatrix[a] && confusionMatrix[a][p] !== undefined) confusionMatrix[a][p]++
  }

  const accuracy = Math.round(finiteNumber(m.accuracy) * 1000) / 10
  const macro = (m['macro avg'] ?? {}) as { 'f1-score'?: number }
  const weighted = (m['weighted avg'] ?? {}) as { 'f1-score'?: number }
  const macroF1 = Math.round(finiteNumber(macro['f1-score']) * 1000) / 10
  const weightedF1 = Math.round(finiteNumber(weighted['f1-score']) * 1000) / 10
  const totalSamples = LABELS.reduce((s, cls) => s + classMetrics[cls].support, 0)
  return { accuracy, macroF1, weightedF1, totalSamples, classMetrics, confusionMatrix }
}

interface Detail {
  uid: string
  scene_id: string
  status: string
  actual_label: string
  predicted_label: string
  confidence_score: number | string
}

function patchIdFromScene(sceneId: string): string {
  return sceneId.split("_").at(-1) ?? sceneId
}

function isSevere(label: string): boolean {
  return label === "Major Damage" || label === "Destroyed"
}

function buildGeoComparison(details: Detail[]) {
  const byPatch = new Map<string, {
    patchId: string
    total: number
    correct: number
    actualSevere: number
    predictedSevere: number
  }>()

  for (const detail of details) {
    const patchId = patchIdFromScene(detail.scene_id)
    const current = byPatch.get(patchId) ?? {
      patchId,
      total: 0,
      correct: 0,
      actualSevere: 0,
      predictedSevere: 0,
    }

    current.total += 1
    if (detail.actual_label === detail.predicted_label) current.correct += 1
    if (isSevere(detail.actual_label)) current.actualSevere += 1
    if (isSevere(detail.predicted_label)) current.predictedSevere += 1
    byPatch.set(patchId, current)
  }

  return [...byPatch.values()].map((patch) => ({
    ...patch,
    accuracy: patch.total > 0 ? Math.round((patch.correct / patch.total) * 1000) / 10 : 0,
    severeDelta: patch.predictedSevere - patch.actualSevere,
  }))
}

async function fetchAndCachePipeline() {
  const cachePath = join(process.cwd(), 'content', 'cache', 'pipeline_results_full.json')
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf-8'))
  }
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'content', 'manifest.json'), 'utf-8'))
  const base = manifest.patches[0].postJson.split('/labels/')[0]
  const res = await fetch(`${base}/generated_labels/pipeline_results_full.json`)
  if (!res.ok) throw new Error('Failed to fetch pipeline results')
  const data = await res.json()
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, JSON.stringify(data))
  return data
}

export async function GET() {
  try {
    const pipeline = await fetchAndCachePipeline()

    const pipelineModelId = Object.keys(pipeline.metrics)[0]
    const pipelineDetails: Detail[] = pipeline.details ?? []
    const model = {
      id: pipelineModelId,
      shortName: MODEL_NAMES[pipelineModelId] ?? pipelineModelId,
      source: 'pipeline' as const,
      ...normalizePipelineModel(pipeline.metrics[pipelineModelId], pipelineDetails),
    }

    // Confidence distribution from pipeline details
    const confBins: Record<number, number> = {}
    for (const d of pipelineDetails) {
      const raw = typeof d.confidence_score === 'string'
        ? parseInt(d.confidence_score.replace('%', ''))
        : d.confidence_score
      if (!isNaN(raw)) {
        const bin = Math.min(9, Math.floor(raw / 10)) * 10
        confBins[bin] = (confBins[bin] ?? 0) + 1
      }
    }
    const confidenceDistribution = Array.from({ length: 10 }, (_, i) => i * 10).map(bin => ({
      bin,
      label: bin === 90 ? '90–100' : `${bin}–${bin + 9}`,
      count: confBins[bin] ?? 0,
    }))

    // Actual vs predicted class distribution from pipeline
    const actualCounts = Object.fromEntries(LABELS.map(l => [l, 0]))
    const predictedCounts = Object.fromEntries(LABELS.map(l => [l, 0]))
    for (const d of pipelineDetails) {
      if (actualCounts[d.actual_label] !== undefined) actualCounts[d.actual_label]++
      if (predictedCounts[d.predicted_label] !== undefined) predictedCounts[d.predicted_label]++
    }
    const classDistribution = LABELS.map(label => ({
      label,
      actual: actualCounts[label],
      predicted: predictedCounts[label],
    }))

    // Accuracy by confidence band
    const confAccuracy = Array.from({ length: 10 }, (_, i) => {
      const bin = i * 10
      const inBin = pipelineDetails.filter(d => {
        const raw = typeof d.confidence_score === 'string'
          ? parseInt(d.confidence_score.replace('%', ''))
          : d.confidence_score
        return !isNaN(raw) && raw >= bin && (bin === 90 ? raw <= 100 : raw < bin + 10)
      })
      const correct = inBin.filter(d => d.actual_label === d.predicted_label).length
      return {
        bin,
        label: bin === 90 ? '90–100' : `${bin}–${bin + 9}`,
        count: inBin.length,
        accuracy: inBin.length > 0 ? Math.round((correct / inBin.length) * 1000) / 10 : 0,
      }
    })

    return NextResponse.json({
      model,
      models: [model],
      pipeline: {
        modelId: pipelineModelId,
        totalSamples: pipelineDetails.length,
        confidenceDistribution,
        classDistribution,
        confAccuracy,
        geoComparison: buildGeoComparison(pipelineDetails),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
