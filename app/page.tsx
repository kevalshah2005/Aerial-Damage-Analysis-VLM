"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuthenticator } from "@aws-amplify/ui-react"
import { Map as MapIcon } from "lucide-react"
import dynamic from "next/dynamic"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"

import DashboardHeader from "@/components/dashboard-header"
import ChatPanel from "@/components/chat-panel"
import { DatasetManifest } from "@/lib/types"
import type { MapAction } from "@/lib/map-actions"

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

const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true';

export default function Page() {
  const { authStatus } = useAuthenticator(context => [context.authStatus])
  const router = useRouter()
  const [chatOpen, setChatOpen] = useState(true)
  const mapActionRef = useRef<((action: MapAction) => void) | null>(null)

  const [manifest, setManifest] = useState<DatasetManifest | null>(null)
  const [datasetPreVisible, setDatasetPreVisible] = useState(false)
  const [datasetPostVisible, setDatasetPostVisible] = useState(false)
  const [datasetBuildingsVisible, setDatasetBuildingsVisible] = useState(false)
  const [datasetPredictedVisible, setDatasetPredictedVisible] = useState(false)
  const [datasetPreOpacity, setDatasetPreOpacity] = useState(1)
  const [datasetPostOpacity, setDatasetPostOpacity] = useState(1)
  const [datasetBuildingsOpacity, setDatasetBuildingsOpacity] = useState(1)
  const [datasetPredictedOpacity, setDatasetPredictedOpacity] = useState(1)
  const resetChatDrivenMapState = useCallback(() => {
    setDatasetPreVisible(false)
    setDatasetPostVisible(false)
    setDatasetBuildingsVisible(false)
    setDatasetPredictedVisible(false)
    mapActionRef.current?.({ type: "clear_markers" })
  }, [])

  const handleMapAction = useCallback((action: MapAction) => {
    switch (action.type) {
      case "toggle_layer":
        if (action.layer === "pre") setDatasetPreVisible(v => action.visible ?? !v)
        else if (action.layer === "post") setDatasetPostVisible(v => action.visible ?? !v)
        else if (action.layer === "buildings") setDatasetBuildingsVisible(v => action.visible ?? !v)
        else if (action.layer === "predicted") setDatasetPredictedVisible(v => action.visible ?? !v)
        break
      case "set_layer_opacity":
        if (action.layer === "pre") setDatasetPreOpacity(action.opacity)
        else if (action.layer === "post") setDatasetPostOpacity(action.opacity)
        else if (action.layer === "buildings") setDatasetBuildingsOpacity(action.opacity)
        else if (action.layer === "predicted") setDatasetPredictedOpacity(action.opacity)
        break
      default:
        mapActionRef.current?.(action)
    }
  }, [setDatasetPreVisible, setDatasetPostVisible, setDatasetBuildingsVisible, setDatasetPredictedVisible, setDatasetPreOpacity, setDatasetPostOpacity, setDatasetBuildingsOpacity, setDatasetPredictedOpacity])

  useEffect(() => {
    fetch("/api/dataset/manifest", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) setManifest(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!skipAuth && authStatus === 'unauthenticated') router.push('/auth')
  }, [authStatus, router])

  if (!skipAuth && (authStatus === 'configuring' || authStatus === 'unauthenticated')) {
    return <div className="flex h-screen items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <DashboardHeader chatOpen={chatOpen} onToggleChat={() => setChatOpen(!chatOpen)} />

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {chatOpen ? (
          <PanelGroup direction="horizontal" className="w-full h-full">
            <Panel defaultSize={72} minSize={45}>
              <div className="h-full min-w-0 relative">
                <MapView
                  mapActionRef={mapActionRef}
                  manifest={manifest}
                  datasetPreVisible={datasetPreVisible}
                  datasetPostVisible={datasetPostVisible}
                  datasetBuildingsVisible={datasetBuildingsVisible}
                  datasetPredictedVisible={datasetPredictedVisible}
                  datasetPreOpacity={datasetPreOpacity}
                  datasetPostOpacity={datasetPostOpacity}
                  datasetBuildingsOpacity={datasetBuildingsOpacity}
                  datasetPredictedOpacity={datasetPredictedOpacity}
                  onToggleDatasetPre={() => setDatasetPreVisible(v => !v)}
                  onToggleDatasetPost={() => setDatasetPostVisible(v => !v)}
                  onToggleDatasetBuildings={() => setDatasetBuildingsVisible(v => !v)}
                  onToggleDatasetPredicted={() => setDatasetPredictedVisible(v => !v)}
                  onSetDatasetPreOpacity={setDatasetPreOpacity}
                  onSetDatasetPostOpacity={setDatasetPostOpacity}
                  onSetDatasetBuildingsOpacity={setDatasetBuildingsOpacity}
                  onSetDatasetPredictedOpacity={setDatasetPredictedOpacity}
                />
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 bg-border/60 hover:bg-primary/60 transition-colors relative group" />
            <Panel defaultSize={28} minSize={20} maxSize={45}>
              <div className="h-full border-l border-border bg-card/50 backdrop-blur-md relative z-10 shadow-2xl hidden md:block">
                <ChatPanel
                  onMapAction={handleMapAction}
                  onConversationChange={resetChatDrivenMapState}
                />
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex-1 min-w-0 h-full relative">
            <MapView
              mapActionRef={mapActionRef}
              manifest={manifest}
              datasetPreVisible={datasetPreVisible}
              datasetPostVisible={datasetPostVisible}
              datasetBuildingsVisible={datasetBuildingsVisible}
              datasetPredictedVisible={datasetPredictedVisible}
              datasetPreOpacity={datasetPreOpacity}
              datasetPostOpacity={datasetPostOpacity}
              datasetBuildingsOpacity={datasetBuildingsOpacity}
              datasetPredictedOpacity={datasetPredictedOpacity}
              onToggleDatasetPre={() => setDatasetPreVisible(v => !v)}
              onToggleDatasetPost={() => setDatasetPostVisible(v => !v)}
              onToggleDatasetBuildings={() => setDatasetBuildingsVisible(v => !v)}
              onToggleDatasetPredicted={() => setDatasetPredictedVisible(v => !v)}
              onSetDatasetPreOpacity={setDatasetPreOpacity}
              onSetDatasetPostOpacity={setDatasetPostOpacity}
              onSetDatasetBuildingsOpacity={setDatasetBuildingsOpacity}
              onSetDatasetPredictedOpacity={setDatasetPredictedOpacity}
            />
          </div>
        )}
      </div>
    </div>
  )
}
