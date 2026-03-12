export interface ImageryLayer {
  id: string
  name: string
  url?: string
  type: 'pre' | 'post' | 'buildings'
  visible: boolean
  opacity: number
  highlighted?: boolean
  bounds?: [[number, number], [number, number]]
  geometries?: any[]
}
