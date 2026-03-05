"use client"

import { Globe, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuthenticator } from "@aws-amplify/ui-react"

interface DashboardHeaderProps {
  chatOpen: boolean
  onToggleChat: () => void
  leftPanelOpen: boolean
  onToggleLeftPanel: () => void
}

export default function DashboardHeader({
  chatOpen,
  onToggleChat,
  leftPanelOpen,
  onToggleLeftPanel,
}: DashboardHeaderProps) {
  const { signOut, user } = useAuthenticator()

  return (
    <header className="flex items-center justify-between h-12 px-4 bg-card border-b border-border shrink-0">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleLeftPanel}
          className="h-8 w-8 text-muted-foreground hover:text-foreground mr-1"
          aria-label={leftPanelOpen ? "Close layer manager" : "Open layer manager"}
        >
          {leftPanelOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </Button>
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
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground hidden lg:inline mr-2 font-medium">
          {user?.signInDetails?.loginId || user?.username}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut()}
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Logout</span>
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
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
