import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import type { Group } from 'three'
import { useWallStore } from '../../stores/wallStore'
import type { Point2, StickyNoteData } from '../../types/wall'
import { NOTE_HEIGHT, NOTE_WIDTH } from '../../utils/constants'
import { getNoteSize, resizeFromCorner } from '../../utils/noteDimensions'
import { NOTE_HANDLE_OFFSET } from '../../three/noteLayers'
import { projectOnWall } from '../../three/noteProjection'
import { captureNotePointer, watchNotePointer } from '../../three/notePointer'

const corners: Point2[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]

interface ResizeSession {
  pointerId: number
  start: Point2
  corner: Point2
  preview?: ReturnType<typeof resizeFromCorner>
  release: () => void
  stop: () => void
}

export function NoteResizeHandles({ note, object, footprint, depth }: {
  note: StickyNoteData
  object: RefObject<Group | null>
  footprint: RefObject<Group | null>
  depth: number
}) {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const resize = useRef<ResizeSession | null>(null)
  const handleDepth = depth + NOTE_HANDLE_OFFSET

  useLayoutEffect(() => () => {
    if (!resize.current) return
    finish(false)
  }, [note.id, gl])

  function start(event: ThreeEvent<PointerEvent>, corner: Point2) {
    const state = useWallStore.getState()
    const wall = object.current?.parent
    if (!wall || state.editingId || state.draggingId || state.mode !== 'select' || event.button !== 0 || !event.nativeEvent.isPrimary) return
    event.stopPropagation()
    const point = projectOnWall(event.ray, wall, handleDepth)
    if (!point) return
    const id = event.pointerId
    resize.current = {
      pointerId: id, start: [point.x, point.y], corner,
      release: captureNotePointer(event.target, id),
      stop: watchNotePointer(window, gl.domElement, id, event.nativeEvent.pointerType === 'touch', () => finish(false)),
    }
    state.setDragging(note.id, event.nativeEvent.pointerType === 'touch')
    gl.domElement.style.cursor = corner[0] === corner[1] ? 'nesw-resize' : 'nwse-resize'
  }

  function apply(size: Point2, position: Point2) {
    footprint.current?.scale.set(size[0] / NOTE_WIDTH, size[1] / NOTE_HEIGHT, 1)
    object.current?.position.set(...position, 0)
    gl.shadowMap.needsUpdate = true
    invalidate()
  }

  function move(event: ThreeEvent<PointerEvent>) {
    const session = resize.current
    const wall = object.current?.parent
    if (!session || !wall || session.pointerId !== event.pointerId) return
    event.stopPropagation()
    const point = projectOnWall(event.ray, wall, handleDepth)
    if (!point) return
    const dx = point.x - session.start[0], dy = point.y - session.start[1]
    if (!session.preview && Math.hypot(dx, dy) < 0.015) return
    session.preview = resizeFromCorner(note, session.corner, [dx, dy])
    apply(session.preview.size, session.preview.position)
  }

  function finish(commit: boolean) {
    const session = resize.current
    if (!session) return
    resize.current = null
    session.stop()
    session.release()
    const state = useWallStore.getState()
    if (session.preview) {
      const [width, height] = getNoteSize(note)
      const changed = Math.abs(width - session.preview.size[0]) > 0.001 || Math.abs(height - session.preview.size[1]) > 0.001
      if (commit && changed) state.updateNote(note.id, session.preview)
      else apply([width, height], note.position)
    }
    if (state.draggingId === note.id) state.setDragging(null)
    gl.domElement.style.cursor = ''
  }

  return <group name="note-resize-handles">
    {corners.map((corner) => <group key={corner.join(',')} position={[corner[0] * NOTE_WIDTH / 2, corner[1] * NOTE_HEIGHT / 2, handleDepth]}>
      <mesh raycast={() => null}>
        <circleGeometry args={[0.105, 14]} />
        <meshBasicMaterial color="#655740" toneMapped={false} />
      </mesh>
      <mesh visible={false} onPointerDown={(event) => start(event, corner)} onPointerMove={move}
        onPointerOver={(event) => { event.stopPropagation(); gl.domElement.style.cursor = corner[0] === corner[1] ? 'nesw-resize' : 'nwse-resize' }}
        onPointerOut={() => { if (!resize.current) gl.domElement.style.cursor = '' }}
        onPointerUp={(event) => {
          if (resize.current?.pointerId !== event.pointerId) return
          move(event)
          finish(true)
        }}
        onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
        <planeGeometry args={[0.68, 0.68]} />
      </mesh>
    </group>)}
  </group>
}
