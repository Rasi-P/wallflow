import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { DoubleSide, Mesh, Vector2 } from 'three'
import type { Group, MeshBasicMaterial, MeshStandardMaterial, Ray, PlaneGeometry } from 'three'
import type { StickyNoteData } from '../../types/wall'
import { clampPosition, useWallStore } from '../../stores/wallStore'
import type { BindNoteSurface } from '../../three/noteSurface'
import { NOTE_HEIGHT, NOTE_WIDTH } from '../../utils/constants'
import { getNoteSize } from '../../utils/noteDimensions'
import { NOTE_CONTACT_DEPTH } from '../../three/noteLayers'
import { CONTACT_SHADOW_OPACITY, getPickupLift, stepPaperLift } from '../../three/paperMotion'
import type { PaperMotionFrame } from '../../three/paperMotion'
import { captureNotePointer, watchNotePointer } from '../../three/notePointer'
import { projectOnWall } from '../../three/noteProjection'
import { NoteResizeHandles } from './NoteResizeHandles'
import { getTaskInk } from '../../utils/noteTasks'

interface DragState {
  offset: Vector2
  ray: Ray
  start: Vector2
  pointerId: number
  isTouch: boolean
  moved: boolean
  setDragging: ReturnType<typeof useWallStore.getState>['setDragging']
  stopWatching: () => void
  release: () => void
}

interface NoteProps {
  note: StickyNoteData
  visible: boolean
  depth: number
  paperGeometry: PlaneGeometry
  contactGeometry: PlaneGeometry
  contactMaterial: MeshBasicMaterial
  paperMotions: Set<PaperMotionFrame>
  bindSurface: BindNoteSurface
}

const ignoreRaycast = () => null

export const StickyNote = memo(function StickyNote({ note, visible, depth, paperGeometry, contactGeometry, contactMaterial, paperMotions, bindSurface }: NoteProps) {
  const group = useRef<Group>(null)
  const footprint = useRef<Group>(null)
  const paper = useRef<Mesh>(null)
  const contact = useRef<Mesh<PlaneGeometry, MeshBasicMaterial>>(null)
  const drag = useRef<DragState | null>(null)
  const motion = useRef({ lift: 0, target: 0, reduced: false, material: null as MeshBasicMaterial | null })
  const material = useRef<MeshStandardMaterial>(null)
  const surface = useRef<ReturnType<BindNoteSurface> | null>(null)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const selected = useWallStore((s) => s.selectedId === note.id)
  const editing = useWallStore((s) => s.editingId === note.id)
  const size = getNoteSize(note)
  const { title, body, color, doodle, typography, checklist, priority, dueDate, completed } = note
  const today = useWallStore((state) => dueDate ? state.today : '')
  const task = useMemo(() => getTaskInk({ checklist, priority, dueDate, completed }, today), [checklist, priority, dueDate, completed, today])
  useLayoutEffect(() => {
    if (!material.current) return
    const binding = bindSurface(material.current)
    surface.current = binding
    return () => { surface.current = null; binding.dispose() }
  }, [bindSurface])
  useLayoutEffect(() => {
    surface.current?.update({ title, body, color, doodle, task, typography })
    invalidate()
  }, [bindSurface, title, body, color, doodle, task, typography, invalidate])

  const frame = useCallback<PaperMotionFrame>((delta) => {
    const sheet = paper.current
    const shadow = contact.current
    if (!sheet || !shadow) return false
    const state = motion.current
    const lift = stepPaperLift(state.lift, state.target, delta, state.reduced)
    if (lift !== state.lift) {
      state.lift = lift
      sheet.position.z = depth + lift
      // Keep the same point on the note under the pointer as its height changes.
      const active = drag.current
      const object = group.current
      if (active?.moved && object?.parent) {
        const local = projectOnWall(active.ray, object.parent, sheet.position.z)
        if (local) {
          const [x, y] = clampPosition([local.x - active.offset.x, local.y - active.offset.y], size, note.rotation)
          object.position.set(x, y, 0)
        }
      }
      const amount = Math.min(1, lift / 0.075)
      shadow.position.set(0.035 + amount * 0.043, -0.055 - amount * 0.07, NOTE_CONTACT_DEPTH)
      shadow.scale.set(1 + amount * 0.04, 1 + amount * 0.06, 1)
      if (lift > 0) {
        state.material ??= contactMaterial.clone()
        state.material.opacity = CONTACT_SHADOW_OPACITY + amount * 0.16
        shadow.material = state.material
      } else if (state.material) {
        shadow.material = contactMaterial
        state.material.dispose()
        state.material = null
      }
      gl.shadowMap.needsUpdate = true
    }
    return lift !== state.target
  }, [contactMaterial, depth, gl, size, note.rotation])

  useLayoutEffect(() => () => {
    paperMotions.delete(frame)
    const state = motion.current
    if (state.material) {
      if (contact.current) {
        contact.current.material = contactMaterial
        contact.current.position.set(0.035, -0.055, NOTE_CONTACT_DEPTH)
        contact.current.scale.setScalar(1)
      }
      state.material.dispose()
    }
    state.material = null
    state.target = state.lift = 0
  }, [contactMaterial, frame, paperMotions])

  function animateLift(target: number) {
    motion.current.target = target
    motion.current.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    paperMotions.add(frame)
    invalidate()
  }
  useEffect(() => () => {
    const state = drag.current
    if (!state) return
    state.stopWatching()
    state.release()
    drag.current = null
    const current = useWallStore.getState()
    if (current.setDragging === state.setDragging && current.draggingId === note.id) current.setDragging(null)
    gl.domElement.style.cursor = ''
  }, [note.id, gl])

  function pointerDown(event: ThreeEvent<PointerEvent>) {
    const state = useWallStore.getState()
    if (state.mode !== 'select' || state.editingId || state.draggingId || drag.current || event.button !== 0 || !event.nativeEvent.isPrimary || !group.current?.parent) return
    event.stopPropagation()
    const local = projectOnWall(event.ray, group.current.parent, paper.current?.position.z ?? depth)
    if (!local) return
    const pointerId = event.pointerId
    const isTouch = event.nativeEvent.pointerType === 'touch'
    const unwatchBoard = useWallStore.subscribe((current) => {
      // A touch that has not moved yet does not lock board switching.
      if (current.setDragging !== state.setDragging) finishDrag(false)
    })
    // A second touch cancels the note gesture before OrbitControls starts dolly-pan.
    const unwatchPointer = watchNotePointer(window, gl.domElement, pointerId, isTouch, () => finishDrag(false))
    drag.current = {
      offset: new Vector2(local.x - note.position[0], local.y - note.position[1]),
      ray: event.ray.clone(),
      start: new Vector2(event.clientX, event.clientY),
      pointerId, isTouch, moved: false, setDragging: state.setDragging,
      stopWatching: () => { unwatchBoard(); unwatchPointer() },
      release: captureNotePointer(event.target, pointerId),
    }
    // In select mode OrbitControls tracks the initial touch without moving the camera.
    if (!isTouch) {
      state.setDragging(note.id)
      gl.domElement.style.cursor = 'grabbing'
    }
    state.select(note.id)
  }

  function pointerMove(event: ThreeEvent<PointerEvent>) {
    const state = drag.current
    const object = group.current
    if (!state || !object?.parent || state.pointerId !== event.pointerId) return
    event.stopPropagation()
    if (!state.moved && Math.hypot(event.clientX - state.start.x, event.clientY - state.start.y) <= 4) return
    const local = projectOnWall(event.ray, object.parent, paper.current?.position.z ?? depth)
    if (!local) return
    const lifted = !state.moved
    state.ray.copy(event.ray)
    if (lifted) {
      state.moved = true
      state.setDragging(note.id, state.isTouch)
      animateLift(getPickupLift(depth))
    }
    const [x, y] = clampPosition([local.x - state.offset.x, local.y - state.offset.y], size, note.rotation)
    if (!lifted && object.position.x === x && object.position.y === y) return
    object.position.set(x, y, 0)
    gl.shadowMap.needsUpdate = true
    invalidate()
  }

  function pointerUp(event: ThreeEvent<PointerEvent>) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    pointerMove(event)
    finishDrag(true)
  }

  function finishDrag(commit: boolean) {
    const state = drag.current
    if (!state) return
    drag.current = null
    state.stopWatching()
    state.release()
    const current = useWallStore.getState()
    const sameBoard = current.setDragging === state.setDragging
    const object = group.current
    if (object && state.moved) {
      if (commit && sameBoard) current.updateNote(note.id, { position: [object.position.x, object.position.y] })
      else object.position.set(note.position[0], note.position[1], 0)
      animateLift(0)
      gl.shadowMap.needsUpdate = true
    }
    if (sameBoard && current.draggingId === note.id) current.setDragging(null)
    gl.domElement.style.cursor = ''
  }

  return (
    <group ref={group} visible={visible} position={[...note.position, 0]} rotation={[0, 0, note.rotation]} name={`note-${note.id}`}>
      <group ref={footprint} scale={[size[0] / NOTE_WIDTH, size[1] / NOTE_HEIGHT, 1]}>
      <mesh ref={contact} position={[0.035, -0.055, NOTE_CONTACT_DEPTH]} geometry={contactGeometry} material={contactMaterial} raycast={() => null} />
      <mesh ref={paper} position={[0, 0, depth]} geometry={paperGeometry} castShadow receiveShadow raycast={visible ? Mesh.prototype.raycast : ignoreRaycast}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
        onClick={(e) => { if (useWallStore.getState().mode === 'select') e.stopPropagation() }}
        onDoubleClick={(e) => { if (useWallStore.getState().mode === 'select') { e.stopPropagation(); useWallStore.getState().editNote(note.id) } }}
        onPointerOver={(e) => { if (useWallStore.getState().mode === 'select') { e.stopPropagation(); gl.domElement.style.cursor = 'grab' } }}
        onPointerOut={() => { if (!drag.current) gl.domElement.style.cursor = '' }}>
        <meshStandardMaterial ref={material} roughness={0.93} side={DoubleSide} />
      </mesh>
      {selected && !editing && <mesh position={[0, 0, depth - 0.015]} raycast={() => null}>
        <planeGeometry args={[NOTE_WIDTH + 0.078, NOTE_HEIGHT + 0.078]} />
        <meshBasicMaterial color="#8f7957" transparent opacity={0.72} depthWrite={false} toneMapped={false} />
      </mesh>}
      {visible && selected && !editing && <NoteResizeHandles note={note} object={group} footprint={footprint} depth={depth} />}
      </group>
    </group>
  )
})
