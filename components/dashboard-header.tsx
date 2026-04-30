"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Globe, PanelRightClose, PanelRightOpen, LogOut, BarChart2, Map } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuthenticator } from "@aws-amplify/ui-react"

interface DashboardHeaderProps {
  chatOpen?: boolean
  onToggleChat?: () => void
}

export default function DashboardHeader({ chatOpen, onToggleChat }: DashboardHeaderProps) {
  const { signOut, user } = useAuthenticator()
  const pathname = usePathname()

  return (
    <header className="flex items-center justify-between h-12 px-4 bg-card border-b border-border shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/15">
            <Globe className="h-4 w-4 text-primary" />
          </div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-sm font-bold text-foreground tracking-tight">GeoView</h1>
            <span className="text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
              BETA
            </span>
          </div>
        </div>

        <nav className="flex items-center gap-0.5 ml-2">
          <Link
            href="/"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              pathname === '/'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <Map className="h-3.5 w-3.5" />
            Map
          </Link>
          <Link
            href="/stats"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              pathname === '/stats'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <BarChart2 className="h-3.5 w-3.5" />
            Statistics
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground hidden lg:inline mr-2 font-medium">
          {user?.signInDetails?.loginId ?? user?.username}
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
        {onToggleChat && (
          <>
            <div className="w-px h-4 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleChat}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Toggle chat panel"
            >
              {chatOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
