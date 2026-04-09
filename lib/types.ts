export interface DatasetPatch {
  id: string
  pre: string
  post: string
  preJson: string
  postJson: string
  bounds: [[number, number], [number, number]]
  buildingCount: number
}

export interface DatasetManifest {
  patches: DatasetPatch[]
  totalBounds: [[number, number], [number, number]]
  count: number
}
