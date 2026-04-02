"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthenticator } from "@aws-amplify/ui-react"
import { Map as MapIcon } from "lucide-react"
import dynamic from "next/dynamic"

import DashboardHeader from "@/components/dashboard-header"
import ChatPanel from "@/components/chat-panel"
import { DatasetManifest } from "@/lib/types"

const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-muted animate-pulse flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <MapIcon className="h-8 w-8 text-muted-foreground/50" />
        <span className="text-xs font-medium text-muted-foreground/50 uppercase tracking-widest">Initializing Map...</span>
      </div>
    </div>
  )
})

export default function Page() {
  const { authStatus } = useAuthenticator(context => [context.authStatus])
  const router = useRouter()
  const [chatOpen, setChatOpen] = useState(true)

  const [manifest, setManifest] = useState<DatasetManifest | null>(null)
  const [datasetPreVisible, setDatasetPreVisible] = useState(false)
  const [datasetPostVisible, setDatasetPostVisible] = useState(false)
  const [datasetBuildingsVisible, setDatasetBuildingsVisible] = useState(false)
  const [datasetPreOpacity, setDatasetPreOpacity] = useState(1)
  const [datasetPostOpacity, setDatasetPostOpacity] = useState(1)
  const [datasetBuildingsOpacity, setDatasetBuildingsOpacity] = useState(1)

  useEffect(() => {
    fetch("/api/dataset/manifest")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) setManifest(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/auth')
  }, [authStatus, router])

  if (authStatus === 'configuring' || authStatus === 'unauthenticated') {
    return <div className="flex h-screen items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <DashboardHeader chatOpen={chatOpen} onToggleChat={() => setChatOpen(!chatOpen)} />

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <div className="flex-1 min-w-0 h-full relative">
          <MapView
            manifest={manifest}
            datasetPreVisible={datasetPreVisible}
            datasetPostVisible={datasetPostVisible}
            datasetBuildingsVisible={datasetBuildingsVisible}
            datasetPreOpacity={datasetPreOpacity}
            datasetPostOpacity={datasetPostOpacity}
            datasetBuildingsOpacity={datasetBuildingsOpacity}
            onToggleDatasetPre={() => setDatasetPreVisible(v => !v)}
            onToggleDatasetPost={() => setDatasetPostVisible(v => !v)}
            onToggleDatasetBuildings={() => setDatasetBuildingsVisible(v => !v)}
            onSetDatasetPreOpacity={setDatasetPreOpacity}
            onSetDatasetPostOpacity={setDatasetPostOpacity}
            onSetDatasetBuildingsOpacity={setDatasetBuildingsOpacity}
          />
        </div>

        {chatOpen && <div className="w-[400px] border-l border-border shrink-0 hidden md:block bg-card/50 backdrop-blur-md relative z-10 shadow-2xl"><ChatPanel /></div>}
      </div>
    </div>
  )
}
