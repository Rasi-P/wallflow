import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { RefObject } from 'react'
import { MathUtils, Vector3 } from 'three'
import type { Group, Object3D } from 'three'
import { registerVisibleNoteSlots, useWallStore } from '../stores/wallStore'
import { visibleWallSlots } from './noteProjection'

export function NoteEditorPosition({ wall, element }: { wall: RefObject<Group | null>; element: HTMLDivElement | null }) {
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const point = useMemo(() => new Vector3(), [])
  const active = useMemo(() => ({ id: null as string | null, object: null as Object3D | null }), [])
  useEffect(() => registerVisibleNoteSlots(() => wall.current ? visibleWallSlots(camera, wall.current) : []), [camera, wall])
  useEffect(() => {
    if (!element) return
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => invalidate())
    const viewport = window.visualViewport
    observer?.observe(element)
    const refresh = () => invalidate()
    viewport?.addEventListener('resize', refresh)
    viewport?.addEventListener('scroll', refresh)
    refresh()
    return () => {
      observer?.disconnect()
      viewport?.removeEventListener('resize', refresh)
      viewport?.removeEventListener('scroll', refresh)
    }
  }, [element, invalidate])

  useFrame(({ size, gl }) => {
    const id = useWallStore.getState().editingId
    if (!id || !element) { active.id = null; active.object = null; return }
    if (id !== active.id || !active.object) {
      active.id = id
      active.object = wall.current?.getObjectByName(`note-${id}`) ?? null
    }
    const note = active.object
    if (!note) return
    camera.updateMatrixWorld()
    note.getWorldPosition(point).project(camera)
    const paper = gl.domElement.getBoundingClientRect()
    const app = element.offsetParent?.getBoundingClientRect()
    const originX = app?.left ?? 0, originY = app?.top ?? 0
    const width = app?.width ?? size.width, height = app?.height ?? size.height
    const screenX = paper.left - originX + (point.x + 1) * size.width / 2
    const screenY = paper.top - originY + (1 - point.y) * size.height / 2
    const viewport = window.visualViewport
    const visibleX = Math.max(0, (viewport?.offsetLeft ?? 0) - originX)
    const visibleY = Math.max(0, (viewport?.offsetTop ?? 0) - originY)
    const top = visibleY + 12
    const bottom = Math.min(height, visibleY + (viewport?.height ?? height)) - 12
    const maxHeight = `${Math.max(60, Math.round(bottom - top))}px`
    if (element.style.maxHeight !== maxHeight) element.style.maxHeight = maxHeight
    const maxWidth = `${Math.max(120, Math.floor((viewport?.width ?? width) - 24))}px`
    if (element.style.maxWidth !== maxWidth) element.style.maxWidth = maxWidth
    const halfWidth = element.offsetWidth / 2
    const halfHeight = element.offsetHeight / 2
    const leftEdge = visibleX + halfWidth + 12
    const rightEdge = Math.min(width, visibleX + (viewport?.width ?? width)) - halfWidth - 12
    const x = MathUtils.clamp(screenX, leftEdge, Math.max(leftEdge, rightEdge))
    const y = MathUtils.clamp(screenY, top + halfHeight, Math.max(top + halfHeight, bottom - halfHeight))
    const left = `${Math.round(x)}px`, center = `${Math.round(y)}px`
    if (element.style.left !== left) element.style.left = left
    if (element.style.top !== center) element.style.top = center
  })
  return null
}
