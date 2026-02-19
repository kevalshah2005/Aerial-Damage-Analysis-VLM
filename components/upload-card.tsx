"use client"

import { useEffect, useRef, useState } from "react"

export default function UploadCard({
  onImageUpload,
  resetSignal,
}: {
  onImageUpload: () => void
  resetSignal: number
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<string | null>(null)

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const url = URL.createObjectURL(file)
    setImage(url)
    onImageUpload()
  }

  // Clear image when resetSignal changes
  useEffect(() => {
    setImage(null)
  }, [resetSignal])

  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      className="border border-dashed border-gray-400 rounded-lg w-full h-40 
                 flex items-center justify-center cursor-pointer overflow-hidden 
                 bg-gray-50 hover:bg-gray-100 transition"
    >
      {image ? (
        <img src={image} className="w-full h-full object-cover" />
      ) : (
        <span className="text-4xl text-gray-400">+</span>
      )}

      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleUpload}
        className="hidden"
      />
    </div>
  )
}