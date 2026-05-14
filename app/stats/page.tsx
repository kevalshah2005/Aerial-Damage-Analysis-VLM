'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthenticator } from '@aws-amplify/ui-react'
import dynamic from 'next/dynamic'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts'
import DashboardHeader from '@/components/dashboard-header'

const DamageDistributionMap = dynamic(
  () => import('@/components/damage-distribution-map'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full rounded-xl bg-muted animate-pulse flex items-center justify-center border border-border" style={{ height: 640 }}>
        <span className="text-xs text-muted-foreground">Loading damage map…</span>
      </div>
    ),
  }
)

const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

const DAMAGE_CLASSES = ['No Damage', 'Minor Damage', 'Major Damage', 'Destroyed'] as const
type DamageClass = typeof DAMAGE_CLASSES[number]

const SHORT_LABELS: Record<DamageClass, string> = {
  'No Damage': 'None',
  'Minor Damage': 'Minor',
  'Major Damage': 'Major',
  'Destroyed': 'Dest.',
}

const CLASS_COLORS: Record<DamageClass, string> = {
  'No Damage': '#34d399',
  'Minor Damage': '#facc15',
  'Major Damage': '#f97316',
  'Destroyed': '#a855f7',
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function formatPercent(value: unknown): string {
  return `${safeNumber(value).toFixed(1)}%`
}

interface ClassMetric { precision: number; recall: number; f1: number; support: number }
interface ModelStats {
  id: string
  shortName: string
  source: 'benchmark' | 'pipeline'
  accuracy: number
  macroF1: number
  weightedF1: number
  totalSamples: number
  classMetrics: Record<DamageClass, ClassMetric>
  confusionMatrix: Record<DamageClass, Record<DamageClass, number>>
}
interface PipelineStats {
  modelId: string
  totalSamples: number
  confidenceDistribution: { bin: number; label: string; count: number }[]
  classDistribution: { label: string; actual: number; predicted: number }[]
  confAccuracy: { bin: number; label: string; count: number; accuracy: number }[]
  geoComparison?: {
    patchId: string
    total: number
    correct: number
    accuracy: number
    actualSevere: number
    predictedSevere: number
    severeDelta: number
  }[]
}
interface StatsData {
  model?: ModelStats
  models: ModelStats[]
  pipeline: PipelineStats
}

interface GeoData {
  patches: {
    id: string
    centroid: { lat: number; lon: number }
    buildingCount: number
    projection: number
    post: string | null
  }[]
  corridor: {
    center: { lat: number; lon: number }
    corners: [number, number][]
    axisStart: [number, number]
    axisEnd: [number, number]
    lengthKm: number
    widthKm: number
    bearingDeg: number
  }
  stats: {
    totalBuildings: number
    maxBuildings: number
    totalPatches: number
    affectedAreaKm2: number
  }
  profile: { positionKm: number; buildings: number }[]
}

export default function StatsPage() {
  const { authStatus } = useAuthenticator(context => [context.authStatus])
  const router = useRouter()
  const [data, setData] = useState<StatsData | null>(null)
  const [geoData, setGeoData] = useState<GeoData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!skipAuth && authStatus === 'unauthenticated') router.push('/auth')
  }, [authStatus, router])

  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then(async r => r.ok ? r.json() : null),
      fetch('/api/geo-stats').then(async r => r.ok ? r.json() : null),
    ]).then(([stats, geo]) => {
      const hasModel = Boolean(stats?.model) || Array.isArray(stats?.models)
      setData(hasModel ? stats : null)
      setGeoData(geo)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (!skipAuth && (authStatus === 'configuring' || authStatus === 'unauthenticated')) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <DashboardHeader />
      <main className="flex-1 overflow-auto p-6">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}
        {!loading && !data && (
          <p className="text-muted-foreground text-center mt-20">Failed to load statistics.</p>
        )}
        {!loading && data && <StatsContent data={data} geoData={geoData} />}
      </main>
    </div>
  )
}

function StatsContent({ data, geoData }: { data: StatsData; geoData: GeoData | null }) {
  const model = data.model ?? data.models?.[0]
  if (!model || !data.pipeline) {
    return (
      <div className="max-w-6xl mx-auto pb-10">
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-xl font-bold tracking-tight">Statistics unavailable</h2>
          <p className="text-xs text-muted-foreground mt-1">Stats API returned no model metrics.</p>
        </div>
      </div>
    )
  }

  const geoComparison = data.pipeline.geoComparison ?? []
  const totalCorrect = geoComparison.reduce((s, p) => s + safeNumber(p.correct), 0)
  const totalCompared = geoComparison.reduce((s, p) => s + safeNumber(p.total), 0)
  const mapAccuracy = totalCompared > 0 ? (totalCorrect / totalCompared) * 100 : safeNumber(model.accuracy)

  const totalActualSevere = geoComparison.reduce((s, p) => s + p.actualSevere, 0)
  const totalPredictedSevere = geoComparison.reduce((s, p) => s + p.predictedSevere, 0)
  const severePrecision = totalPredictedSevere > 0
    ? (geoComparison.reduce((s, p) => s + Math.min(p.actualSevere, p.predictedSevere), 0) / totalPredictedSevere) * 100
    : 0

  const barChartData = DAMAGE_CLASSES.map(cls => ({
    name: SHORT_LABELS[cls],
    Precision: safeNumber(model.classMetrics?.[cls]?.precision),
    Recall: safeNumber(model.classMetrics?.[cls]?.recall),
    F1: safeNumber(model.classMetrics?.[cls]?.f1),
    color: CLASS_COLORS[cls],
  }))

  // High-confidence metrics
  const highConfSamples = data.pipeline.confAccuracy.filter(b => b.bin >= 80)
  const highConfAccuracy = highConfSamples.length
    ? highConfSamples.reduce((s, b) => s + b.accuracy * b.count, 0) / Math.max(highConfSamples.reduce((s, b) => s + b.count, 0), 1)
    : 0

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-10">

      {/* Hero */}
      <section className="relative overflow-hidden rounded-xl border border-border bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.12),transparent_40%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--background)))] p-7">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-2">VLM Pipeline · Joplin, MO</div>
            <h1 className="text-3xl font-black tracking-tight">{model.shortName}</h1>
            <p className="text-xs text-muted-foreground mt-2 max-w-xl leading-relaxed">
              Multimodal damage assessment across {data.pipeline.totalSamples.toLocaleString()} building patches
              using pre/post disaster satellite imagery. Evaluated against xBD ground-truth labels.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0">
            <HeroMetric label="Accuracy" value={formatPercent(model.accuracy)} accent="text-emerald-400" />
            <HeroMetric label="Macro F1" value={formatPercent(model.macroF1)} accent="text-blue-400" />
            <HeroMetric label="Spatial Acc." value={formatPercent(mapAccuracy)} accent="text-amber-400" />
            <HeroMetric label="High-Conf. Acc." value={formatPercent(highConfAccuracy)} accent="text-purple-400" />
          </div>
        </div>
      </section>

      {/* Per-class damage cards */}
      <section className="space-y-4">
        <SectionHeader
          title="Per-Class Performance"
          sub={`${data.pipeline.totalSamples.toLocaleString()} samples — precision, recall, and F1 per damage category`}
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {DAMAGE_CLASSES.map(cls => {
            const m = model.classMetrics?.[cls]
            if (!m) return null
            const color = CLASS_COLORS[cls]
            const f1 = safeNumber(m.f1)
            return (
              <div key={cls} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
                <div
                  className="absolute inset-0 opacity-[0.04] pointer-events-none"
                  style={{ background: `radial-gradient(circle at top left, ${color}, transparent 60%)` }}
                />
                <div className="flex items-center gap-2 relative">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-[11px] text-muted-foreground font-medium leading-tight">{cls}</span>
                </div>
                <div className="relative">
                  <div className="text-3xl font-black">{formatPercent(f1)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">F1 Score</div>
                </div>
                {/* Mini bar gauge */}
                <div className="relative h-1 rounded-full bg-border overflow-hidden">
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${f1}%`, background: color }} />
                </div>
                <div className="space-y-1 relative">
                  <MetricRow label="Precision" value={formatPercent(m.precision)} />
                  <MetricRow label="Recall" value={formatPercent(m.recall)} />
                  <MetricRow label="Samples" value={safeNumber(m.support).toLocaleString()} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ConfusionMatrixCard matrix={model.confusionMatrix} />
          <PerClassChartCard chartData={barChartData} />
        </div>
      </section>

      {/* Damage overlay map with Gaussian KDE */}
      {geoData && geoComparison.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <SectionHeader
              title="Spatial Damage Distribution"
              sub="Post-disaster satellite imagery overlaid with true vs. predicted severe damage per patch"
            />
            <div className="grid grid-cols-3 gap-3 flex-shrink-0">
              <GeoStatCard label="True Severe" value={totalActualSevere.toLocaleString()} sub="buildings" />
              <GeoStatCard label="Pred. Severe" value={totalPredictedSevere.toLocaleString()} sub="buildings" />
              <GeoStatCard label="Severe Prec." value={formatPercent(severePrecision)} sub="of pred. correct" />
            </div>
          </div>
          <DamageDistributionMap
            patches={geoData.patches}
            comparison={geoComparison}
            corridor={geoData.corridor}
          />
        </section>
      )}

      {/* Confidence Analysis */}
      <section className="space-y-4">
        <SectionHeader
          title="Confidence Analysis"
          sub="Model self-reported confidence distribution and calibration"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ConfDistributionCard data={data.pipeline.confidenceDistribution} />
          <ConfAccuracyCard data={data.pipeline.confAccuracy} />
        </div>
      </section>

      {/* Class distribution */}
      <section className="space-y-4">
        <SectionHeader
          title="Class Distribution"
          sub="Actual vs. predicted label counts across the full evaluation set"
        />
        <ClassDistributionCard data={data.pipeline.classDistribution} />
      </section>

      {/* Damage corridor */}
      {geoData && (
        <section className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <SectionHeader
              title="Damage Corridor"
              sub="Building exposure density — corridor fitted via weighted PCA on patch centroids"
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
              <GeoStatCard label="Buildings" value={geoData.stats.totalBuildings.toLocaleString()} sub="at risk" />
              <GeoStatCard label="Area" value={`${geoData.stats.affectedAreaKm2.toLocaleString()} km²`} sub="affected" />
              <GeoStatCard label="Length" value={`${geoData.corridor.lengthKm} km`} sub={`${geoData.corridor.widthKm} km wide`} />
              <GeoStatCard label="Bearing" value={`${geoData.corridor.bearingDeg}°`} sub={bearingLabel(geoData.corridor.bearingDeg)} />
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-1">Exposure Profile</h3>
            <p className="text-xs text-muted-foreground mb-4">Building count along corridor principal axis</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={geoData.profile} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="profileGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="positionKm"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  label={{ value: 'km along corridor', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  height={36}
                />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [v, 'Buildings']}
                  labelFormatter={v => `${v} km`}
                />
                <Area type="monotone" dataKey="buildings" stroke="#f59e0b" strokeWidth={2} fill="url(#profileGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  )
}

function HeroMetric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border/80 bg-background/55 px-4 py-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">{label}</div>
      <div className={`text-2xl font-black mt-1 ${accent ?? ''}`}>{value}</div>
    </div>
  )
}

function ConfDistributionCard({ data }: { data: { bin: number; label: string; count: number }[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-1">Confidence Distribution</h3>
      <p className="text-xs text-muted-foreground mb-4">Prediction count per confidence band</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
            formatter={(v: number) => [v.toLocaleString(), 'Predictions']}
          />
          <Bar dataKey="count" fill="#818cf8" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ConfAccuracyCard({ data }: { data: { bin: number; label: string; count: number; accuracy: number }[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-1">Accuracy by Confidence</h3>
      <p className="text-xs text-muted-foreground mb-4">Calibration — how accuracy tracks self-reported confidence</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
            formatter={(v: number, name: string) =>
              name === 'accuracy' ? [formatPercent(v), 'Accuracy'] : [safeNumber(v).toLocaleString(), 'Count']
            }
          />
          <Bar dataKey="accuracy" fill="#34d399" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ClassDistributionCard({ data }: { data: { label: string; actual: number; predicted: number }[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-1">True vs. Predicted Label Counts</h3>
      <p className="text-xs text-muted-foreground mb-4">Absolute label frequency — model vs. ground truth</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
            formatter={(v: number) => [v.toLocaleString()]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="actual" name="Ground Truth" fill="#60a5fa" radius={[3, 3, 0, 0]} />
          <Bar dataKey="predicted" name="Predicted" fill="#f97316" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ConfusionMatrixCard({ matrix }: { matrix: Record<DamageClass, Record<DamageClass, number>> }) {
  const allCounts = DAMAGE_CLASSES.flatMap(a => DAMAGE_CLASSES.map(p => matrix[a]?.[p] ?? 0))
  const maxCount = Math.max(...allCounts, 1)

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-1">Confusion Matrix</h3>
      <p className="text-xs text-muted-foreground mb-4">Rows = actual · Columns = predicted</p>
      <div className="overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left text-muted-foreground font-medium pb-2 pr-2 w-20">Actual ↓ / Pred →</th>
              {DAMAGE_CLASSES.map(cls => (
                <th key={cls} className="text-center pb-2 px-1 min-w-[60px]">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: CLASS_COLORS[cls] }} />
                    <span className="text-muted-foreground font-medium">{SHORT_LABELS[cls]}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAMAGE_CLASSES.map(actual => {
              const rowTotal = DAMAGE_CLASSES.reduce((s, p) => s + (matrix[actual]?.[p] ?? 0), 0)
              return (
                <tr key={actual}>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: CLASS_COLORS[actual] }} />
                      <span className="text-muted-foreground font-medium">{SHORT_LABELS[actual]}</span>
                    </div>
                  </td>
                  {DAMAGE_CLASSES.map(predicted => {
                    const count = matrix[actual]?.[predicted] ?? 0
                    const isDiag = actual === predicted
                    const intensity = count / maxCount
                    const bg = isDiag
                      ? `rgba(52, 211, 153, ${intensity > 0 ? intensity * 0.7 + 0.1 : 0})`
                      : `rgba(248, 113, 113, ${intensity > 0 ? intensity * 0.65 + 0.06 : 0})`
                    const pct = rowTotal > 0 ? ((count / rowTotal) * 100).toFixed(0) : '0'
                    return (
                      <td
                        key={predicted}
                        className="text-center py-2 px-1 rounded font-mono"
                        style={{ background: bg }}
                        title={`${actual} → ${predicted}: ${count} (${pct}%)`}
                      >
                        <div className="font-semibold">{count}</div>
                        <div className="text-[9px] text-muted-foreground">{pct}%</div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex items-center gap-4 mt-4 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-400/60" />
            <span>Correct</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-400/60" />
            <span>Incorrect</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PerClassChartCard({ chartData }: { chartData: { name: string; Precision: number; Recall: number; F1: number }[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-1">Precision · Recall · F1</h3>
      <p className="text-xs text-muted-foreground mb-4">Per-class breakdown</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            formatter={(v: number) => [formatPercent(v)]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Precision" fill="#60a5fa" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Recall" fill="#a78bfa" radius={[3, 3, 0, 0]} />
          <Bar dataKey="F1" fill="#34d399" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function GeoStatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">{label}</div>
      <div className="text-xl font-bold mt-1.5">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[10px] font-mono font-medium">{value}</span>
    </div>
  )
}

function bearingLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
  return dirs[Math.round(deg / 45)] + ' direction'
}
