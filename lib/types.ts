export type DatasetBounds = [[number, number], [number, number]]
export type DatasetImageCoordinates = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
]

export interface DatasetPatch {
  id: string
  pre: string
  post: string
  preJson: string
  postJson: string
  predictedJson?: string
  bounds: DatasetBounds
  preBounds?: DatasetBounds
  postBounds?: DatasetBounds
  displayBounds?: DatasetBounds
  snappedPreBounds?: DatasetBounds
  snappedPostBounds?: DatasetBounds
  snappedDisplayBounds?: DatasetBounds
  snappedPreCoordinates?: DatasetImageCoordinates
  snappedPostCoordinates?: DatasetImageCoordinates
  snappedDisplayCoordinates?: DatasetImageCoordinates
  /** Optional quad used only for the dataset perimeter outline (e.g. seam tiles); does not affect image placement. */
  outlineDisplayCoordinates?: DatasetImageCoordinates
  buildingCount: number
}

export interface DatasetManifest {
  patches: DatasetPatch[]
  totalBounds: DatasetBounds
  count: number
}
