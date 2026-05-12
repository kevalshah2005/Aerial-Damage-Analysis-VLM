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

const DamagePathMap = dynamic(() => import('@/components/damage-path-map'), { ssr: false, loading: () => (
  <div className="w-full h-[420px] rounded-lg bg-muted animate-pulse flex items-center justify-center">
    <span className="text-xs text-muted-foreground">Loading map…</span>
  </div>
) })

const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

const DAMAGE_CLASSES = ['No Damage', 'Minor Damage', 'Major Damage', 'Destroyed'] as const
type DamageClass = typeof DAMAGE_CLASSES[number]

interface ClassMetric { precision: string; recall: string; f1: string }
interface StatsData {
  model: string
  accuracy: string
  totalSamples: number
  classMetrics: Record<DamageClass, ClassMetric>
  confusionMatrix: Record<DamageClass, Record<DamageClass, number>>
}

interface GeoData {
  patches: { id: string; centroid: { lat: number; lon: number }; buildingCount: number }[]
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

const parsePct = (s: string) => parseFloat(s.replace('%', ''))

const SHORT_LABELS: Record<DamageClass, string> = {
  'No Damage': 'None',
  'Minor Damage': 'Minor',
  'Major Damage': 'Major',
  'Destroyed': 'Dest.',
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
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/geo-stats').then(r => r.json()),
    ]).then(([stats, geo]) => {
      setData(stats)
      setGeoData(geo)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (!skipAuth && (authStatus === 'configuring' || authStatus === 'unauthenticated')) {
    return <div className="flex h-screen items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
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
  const accuracy = parsePct(data.accuracy)

  const barChartData = DAMAGE_CLASSES.map(cls => ({
    name: SHORT_LABELS[cls],
    Precision: parsePct(data.classMetrics[cls].precision),
    Recall: parsePct(data.classMetrics[cls].recall),
    F1: parsePct(data.classMetrics[cls].f1),
  }))

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-8">
      {/* VLM Performance */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">VLM Performance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Model: <span className="font-mono">{data.model}</span></p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="col-span-1 bg-card border border-border rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Overall Accuracy</span>
            <span className={`text-4xl font-black mt-3 ${accuracy >= 50 ? 'text-emerald-400' : accuracy >= 25 ? 'text-amber-400' : 'text-red-400'}`}>
              {data.accuracy}
            </span>
            <span className="text-xs text-muted-foreground mt-2">{data.totalSamples} samples</span>
          </div>
          {DAMAGE_CLASSES.map(cls => (
            <div key={cls} className="bg-card border border-border rounded-xl p-4 flex flex-col justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium leading-tight">{cls}</span>
              <div className="mt-3">
                <div className="text-2xl font-bold">{data.classMetrics[cls].f1}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">F1 Score</div>
              </div>
              <div className="mt-3 space-y-1">
                <MetricRow label="P" value={data.classMetrics[cls].precision} />
                <MetricRow label="R" value={data.classMetrics[cls].recall} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ConfusionMatrixCard matrix={data.confusionMatrix} />
          <PerClassChartCard chartData={barChartData} />
        </div>
      </section>

      {/* Geographic Damage Analysis */}
      {geoData && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Damage Path Analysis</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Building exposure density across the affected region — corridor fitted via weighted PCA on patch centroids
            </p>
          </div>

          {/* Geo stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <GeoStatCard label="Buildings at Risk" value={geoData.stats.totalBuildings.toLocaleString()} sub="across all patches" />
            <GeoStatCard label="Affected Area" value={`${geoData.stats.affectedAreaKm2.toLocaleString()} km²`} sub="bounding box" />
            <GeoStatCard
              label="Corridor Length"
              value={`${geoData.corridor.lengthKm} km`}
              sub={`${geoData.corridor.widthKm} km wide`}
            />
            <GeoStatCard
              label="Path Bearing"
              value={`${geoData.corridor.bearingDeg}°`}
              sub={bearingLabel(geoData.corridor.bearingDeg)}
            />
          </div>

          {/* Map + profile chart */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <DamagePathMap
                patches={geoData.patches}
                corridor={geoData.corridor}
                maxBuildings={geoData.stats.maxBuildings}
              />
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-1">Damage Profile</h3>
              <p className="text-xs text-muted-foreground mb-4">Building exposure along corridor axis</p>
              <ResponsiveContainer width="100%" height={340}>
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
                  <Area
                    type="monotone"
                    dataKey="buildings"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#profileGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function bearingLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
  return dirs[Math.round(deg / 45)] + ' direction'
}

function GeoStatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-xs text-muted-foreground uppercase tracking-widest font-medium">{label}</div>
      <div className="text-2xl font-bold mt-2">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
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

function ConfusionMatrixCard({ matrix }: { matrix: Record<DamageClass, Record<DamageClass, number>> }) {
  const allCounts = DAMAGE_CLASSES.flatMap(a => DAMAGE_CLASSES.map(p => matrix[a][p]))
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
                <th key={cls} className="text-center text-muted-foreground font-medium pb-2 px-1 min-w-[64px]">
                  {SHORT_LABELS[cls]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAMAGE_CLASSES.map(actual => {
              const rowTotal = DAMAGE_CLASSES.reduce((s, p) => s + matrix[actual][p], 0)
              return (
                <tr key={actual}>
                  <td className="text-muted-foreground font-medium pr-2 py-1 whitespace-nowrap">{SHORT_LABELS[actual]}</td>
                  {DAMAGE_CLASSES.map(predicted => {
                    const count = matrix[actual][predicted]
                    const isDiag = actual === predicted
                    const intensity = count / maxCount
                    const bg = isDiag
                      ? `rgba(52, 211, 153, ${intensity > 0 ? intensity * 0.75 + 0.1 : 0})`
                      : `rgba(248, 113, 113, ${intensity > 0 ? intensity * 0.75 + 0.08 : 0})`
                    const pct = rowTotal > 0 ? ((count / rowTotal) * 100).toFixed(0) : '0'
                    return (
                      <td
                        key={predicted}
                        className="text-center py-2 px-1 rounded font-mono"
                        style={{ background: bg }}
                        title={`Actual: ${actual} → Predicted: ${predicted}\n${count} samples (${pct}% of row)`}
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
            <span>Correct prediction</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-400/60" />
            <span>Incorrect prediction</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PerClassChartCard({ chartData }: { chartData: { name: string; Precision: number; Recall: number; F1: number }[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-1">Per-Class Metrics</h3>
      <p className="text-xs text-muted-foreground mb-4">Precision, Recall, and F1 by damage category</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            formatter={(v: number) => [`${v.toFixed(1)}%`]}
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
