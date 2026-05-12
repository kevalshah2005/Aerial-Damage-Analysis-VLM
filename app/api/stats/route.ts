import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

const BEST_MODEL = 'amazon.nova-pro-v1:0'

export async function GET() {
  const benchmark = JSON.parse(readFileSync(join(process.cwd(), 'content', 'benchmark_results.json'), 'utf-8'))
  const results = JSON.parse(readFileSync(join(process.cwd(), 'results.json'), 'utf-8'))

  const modelMetrics = benchmark.metrics[BEST_MODEL]

  const totalSamples = Object.values(modelMetrics.confusionMatrix as Record<string, Record<string, number>>)
    .reduce((sum, row) => sum + Object.values(row).reduce((s, v) => s + v, 0), 0)

  return NextResponse.json({
    model: BEST_MODEL,
    accuracy: modelMetrics.accuracy,
    classMetrics: modelMetrics.classMetrics,
    confusionMatrix: modelMetrics.confusionMatrix,
    totalSamples,
    results,
  })
}
