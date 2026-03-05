export interface ImageryLayer {
  id: string
  name: string
  url: string
  type: 'pre' | 'post'
  visible: boolean
  opacity: number
  highlighted?: boolean
  bounds?: [[number, number], [number, number]]
  damageLevel?: string
}
