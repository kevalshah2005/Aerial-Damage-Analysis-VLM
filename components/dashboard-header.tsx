"use client"

import { Globe, MessageSquare, PanelRightClose, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DashboardHeaderProps {
  chatOpen: boolean
  onToggleChat: () => void
}

export default function DashboardHeader({
  chatOpen,
  onToggleChat,
}: DashboardHeaderProps) {
  return (
    <header className="flex items-center justify-between h-12 px-4 bg-card border-b border-border shrink-0">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/15">
          <Globe className="h-4 w-4 text-primary" />
        </div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-sm font-bold text-foreground tracking-tight">
            GeoView
          </h1>
          <span className="text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
            BETA
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Aerial Imagery Dashboard
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleChat}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={chatOpen ? "Close chat panel" : "Open chat panel"}
        >
          {chatOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </Button>
      </div>
    </header>
  )
}
