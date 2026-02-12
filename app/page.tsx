"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import DashboardHeader from "@/components/dashboard-header"
import ChatPanel from "@/components/chat-panel"

const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-muted-foreground">Loading map...</span>
      </div>
    </div>
  ),
})

export default function Page() {
  const [chatOpen, setChatOpen] = useState(true)

  return (
    <div className="flex flex-col h-screen">
      <DashboardHeader
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(!chatOpen)}
      />

      <div className="flex flex-1 min-h-0">
        {/* Map area */}
        <div className="flex-1 min-w-0">
          <MapView />
        </div>

        {/* Chat sidebar */}
        {chatOpen && (
          <div className="w-[380px] border-l border-border shrink-0 hidden md:block">
            <ChatPanel />
          </div>
        )}
      </div>

      {/* Mobile chat overlay */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-background/80 backdrop-blur-sm">
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-[380px] bg-card border-l border-border">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-xs font-medium text-foreground">
                GeoView AI Chat
              </span>
              <button
                onClick={() => setChatOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>
            <div className="h-[calc(100%-40px)]">
              <ChatPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
