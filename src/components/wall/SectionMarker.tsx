import { memo, useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { CanvasTexture, Mesh, SRGBColorSpace } from 'three'
import type { Intersection, PlaneGeometry, Raycaster } from 'three'
import type { Point2, WallSection } from '../../types/wall'
import { useWallStore } from '../../stores/wallStore'
import { captureNotePointer, watchNotePointer } from '../../three/notePointer'
import { projectOnWall } from '../../three/noteProjection'
import { clampSectionPosition } from '../../utils/wallSections'

const DEPTH = 0.005
const hits: Intersection[] = []

function raycastHeader(this: Mesh, ray: Raycaster, intersections: Intersection[]) {
  Mesh.prototype.raycast.call(this, ray, hits)
  for (const hit of hits) {
    const uv = hit.uv
    if (uv && uv.x < 0.67 && uv.y > 0.85) intersections.push(hit)
  }
  hits.length = 0
}

function drawSection(name: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 384
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Section labels require Canvas 2D.')
  ctx.beginPath()
  ctx.roundRect(3, 4, 505, 376, 14)
  ctx.strokeStyle = 'rgba(91, 102, 82, 0.31)'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.stroke()

  ctx.setLineDash([])
  ctx.beginPath()
  ctx.roundRect(3, 4, 336, 49, 11)
  ctx.fillStyle = 'rgba(228, 233, 222, 0.95)'
  ctx.fill()
  ctx.fillStyle = '#4f5a47'
  ctx.font = '600 23px "DM Sans", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, 36, 29, 286)
  ctx.fillStyle = '#89947f'
  for (const x of [15, 21]) for (const y of [23, 29, 35]) {
    ctx.beginPath()
    ctx.arc(x, y, 1.4, 0, Math.PI * 2)
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

type SectionDrag = { id: number; fromTouch: boolean; start: Point2; offset: Point2; moved: boolean; cleanup: () => void }

export const SectionMarker = memo(function SectionMarker({ section, geometry }: { section: WallSection; geometry: PlaneGeometry }) {
  const marker = useRef<Mesh>(null)
  const gesture = useRef<SectionDrag | null>(null)
  const canvas = useThree((state) => state.gl.domElement)
  const invalidate = useThree((state) => state.invalidate)
  const texture = useMemo(() => drawSection(section.name), [section.name])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => () => {
    if (!gesture.current) return
    gesture.current.cleanup()
    if (useWallStore.getState().draggingId === section.id) useWallStore.getState().setDragging(null)
    canvas.style.cursor = ''
  }, [canvas, section.id])

  function finish(commit: boolean) {
    const active = gesture.current
    if (!active) return
    gesture.current = null
    active.cleanup()
    if (marker.current && active.moved) {
      const { position } = marker.current
      if (commit) useWallStore.getState().moveSection(section.id, [position.x, position.y])
      else position.set(...section.position, DEPTH)
      invalidate()
    }
    const state = useWallStore.getState()
    if (state.draggingId === section.id) state.setDragging(null)
    canvas.style.cursor = ''
  }

  function pointerDown(event: ThreeEvent<PointerEvent>) {
    const state = useWallStore.getState()
    const parent = marker.current?.parent
    if (!parent || state.mode !== 'select' || state.editingId || state.draggingId || gesture.current ||
      event.button !== 0 || !event.nativeEvent.isPrimary) return
    const hit = projectOnWall(event.ray, parent, DEPTH)
    if (!hit) return
    event.stopPropagation()
    const id = event.pointerId
    const fromTouch = event.nativeEvent.pointerType === 'touch'
    const unwatch = watchNotePointer(window, canvas, id, fromTouch, () => finish(false))
    const release = captureNotePointer(event.target, id)
    gesture.current = {
      id, fromTouch, start: [event.clientX, event.clientY], offset: [hit.x - section.position[0], hit.y - section.position[1]],
      moved: false, cleanup: () => { unwatch(); release() },
    }
    if (!fromTouch) state.setDragging(section.id)
    state.select(null)
    canvas.style.cursor = 'grabbing'
  }

  function pointerMove(event: ThreeEvent<PointerEvent>) {
    const active = gesture.current
    const object = marker.current
    if (!active || !object?.parent || event.pointerId !== active.id) return
    event.stopPropagation()
    if (!active.moved && Math.hypot(event.clientX - active.start[0], event.clientY - active.start[1]) <= 4) return
    const hit = projectOnWall(event.ray, object.parent, DEPTH)
    if (!hit) return
    if (!active.moved) {
      active.moved = true
      useWallStore.getState().setDragging(section.id, active.fromTouch)
    }
    const point = clampSectionPosition([hit.x - active.offset[0], hit.y - active.offset[1]])
    object.position.set(...point, DEPTH)
    invalidate()
  }

  return <mesh ref={marker} name={`section-${section.id}`} position={[...section.position, DEPTH]} geometry={geometry}
    raycast={raycastHeader} onPointerDown={pointerDown} onPointerMove={pointerMove}
    onPointerUp={(event) => { if (event.pointerId === gesture.current?.id) { event.stopPropagation(); finish(true) } }}
    onPointerOver={(event) => {
      if (useWallStore.getState().mode === 'select') {
        event.stopPropagation()
        if (!gesture.current) canvas.style.cursor = 'grab'
      }
    }}
    onPointerOut={() => { if (!gesture.current) canvas.style.cursor = '' }}
    onClick={(event) => event.stopPropagation()}>
    <meshBasicMaterial map={texture} transparent alphaTest={0.03} depthWrite={false} toneMapped={false} />
  </mesh>
})
