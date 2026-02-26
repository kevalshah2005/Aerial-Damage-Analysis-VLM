"use client"

import React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Trash2, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ImageryPairCardProps {
  preImage: string | null
  postImage: string | null
  damageLevel: string
  label?: string
  onDelete?: () => void
  onView?: () => void
}

export default function ImageryPairCard({
  preImage,
  postImage,
  damageLevel,
  label,
  onDelete,
  onView,
}: ImageryPairCardProps) {
  return (
    <Card className="w-full bg-card border-border overflow-hidden group relative transition-all hover:border-primary/30">
      {/* Hover Actions */}
      <div className="absolute top-2 right-2 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background"
          onClick={(e) => {
            e.stopPropagation();
            onView?.();
          }}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button
          variant="destructive"
          size="icon"
          className="h-8 w-8 bg-destructive/80 backdrop-blur-sm hover:bg-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <CardContent 
        className="p-4 flex flex-col gap-4 cursor-pointer"
        onClick={onView}
      >
        {label && (
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {label}
            </span>
          </div>
        )}

        {/* PRE-DISASTER IMAGE */}
        <div className="relative aspect-video bg-muted rounded-md overflow-hidden border border-border/50">
          <div className="absolute top-2 left-2 z-10">
            <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm text-[10px] py-0 px-1.5 h-5 border-none">
              PRE
            </Badge>
          </div>
          {preImage ? (
            <img src={preImage} alt="Pre-disaster" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <span className="text-xs">No Pre Image</span>
            </div>
          )}
        </div>

        {/* POST-DISASTER IMAGE */}
        <div className="relative aspect-video bg-muted rounded-md overflow-hidden border border-border/50">
          <div className="absolute top-2 left-2 z-10">
            <Badge variant="destructive" className="bg-destructive/80 backdrop-blur-sm text-[10px] py-0 px-1.5 h-5 border-none">
              POST
            </Badge>
          </div>
          {postImage ? (
            <img src={postImage} alt="Post-disaster" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <span className="text-xs">No Post Image</span>
            </div>
          )}
        </div>

        {/* DAMAGE EVALUATION */}
        <div className="mt-2 pt-3 border-t border-border flex flex-col items-center gap-1">
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">
            Damage Evaluation
          </span>
          <div className={cn(
            "text-sm font-bold uppercase tracking-wide px-3 py-1 rounded-full",
            damageLevel === "no-damage" ? "bg-emerald-500/20 text-emerald-500" :
            damageLevel === "minor-damage" ? "bg-amber-500/20 text-amber-500" :
            damageLevel === "major-damage" ? "bg-orange-500/20 text-orange-500" :
            damageLevel === "destroyed" ? "bg-destructive/20 text-destructive" :
            "bg-secondary text-secondary-foreground"
          )}>
            {damageLevel.replace(/-/g, ' ')}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
