"use client"


import { useState } from "react"
import dynamic from "next/dynamic"
import DashboardHeader from "@/components/dashboard-header"
import ChatPanel from "@/components/chat-panel"
import UploadCard from "@/components/upload-card"

export default function Page() {
  const [chatOpen, setChatOpen] = useState(true)

  // Track uploads for each column (0, 1, 2)
  const [uploads, setUploads] = useState([0, 0, 0])

  // Signal to tell UploadCards to clear themselves
  const [resetSignal, setResetSignal] = useState(0)

  const handleUpload = (col: number) => {
    setUploads(prev => {
      const updated = [...prev]
      updated[col] += 1
      return updated
    })
  }

  const damageText = uploads.map(count =>
    count >= 2 ? "minor-damage" : "N/A"
  )

  return (
    <div className="flex flex-col h-screen">
      <DashboardHeader
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(!chatOpen)}
      />

      {/* MAIN CONTENT ROW */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT SIDE: Cards + Spacer + Instructions */}
        <div className="flex flex-col flex-1 min-w-0 p-6">

          {/* Clear All Button */}
          <button
            onClick={() => {
              setUploads([0, 0, 0])        // Reset damage counters
              setResetSignal(prev => prev + 1) // Tell cards to clear
            }}
            className="self-end mb-4 px-4 py-2 text-sm font-medium 
                       bg-destructive/10 text-destructive border border-destructive 
                       rounded-md hover:bg-destructive hover:text-white 
                       transition-colors"
          >
            Clear All
          </button>

          {/* Cards Grid */}
          <div className="grid grid-cols-3 gap-4">
            <UploadCard onImageUpload={() => handleUpload(0)} resetSignal={resetSignal} />
            <UploadCard onImageUpload={() => handleUpload(1)} resetSignal={resetSignal} />
            <UploadCard onImageUpload={() => handleUpload(2)} resetSignal={resetSignal} />
            <UploadCard onImageUpload={() => handleUpload(0)} resetSignal={resetSignal} />
            <UploadCard onImageUpload={() => handleUpload(1)} resetSignal={resetSignal} />
            <UploadCard onImageUpload={() => handleUpload(2)} resetSignal={resetSignal} />
          </div>

          {/* Damage Level Section */}
          <div className="grid grid-cols-3 gap-4 mt-4 text-center text-sm text-muted-foreground">
            <div>
              <p>Damage Level:</p>
              <p>{damageText[0]}</p>
            </div>
            <div>
              <p>Damage Level:</p>
              <p>{damageText[1]}</p>
            </div>
            <div>
              <p>Damage Level:</p>
              <p>{damageText[2]}</p>
            </div>
          </div>

          {/* Line break */}
          <div className="border-t border-border my-4"></div>

          {/* Instructions */}
          <p className="text-center text-sm text-muted-foreground max-w-xl mx-auto">
            Instructions: Click on the top row upload cards to upload your pre‑disaster aerial images.
            Click on the card directly below to upload the respective post‑disaster aerial image.
            Once a pair is uploaded, the model will display the predicted damage evaluation below
            the post‑disaster aerial image.
          </p>

        </div>

        {/* RIGHT SIDE: Desktop Chat Sidebar */}
        {chatOpen && (
          <div className="w-[380px] border-l border-border shrink-0 hidden md:block">
            <ChatPanel />
          </div>
        )}
      </div>

      {/* Mobile Chat Overlay */}
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