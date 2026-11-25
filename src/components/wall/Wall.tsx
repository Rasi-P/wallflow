import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils, MeshBasicMaterial, PlaneGeometry } from 'three'
import type { Group } from 'three'
import { useWallStore } from '../../stores/wallStore'
import { createContactShadow, createPlasterTexture, createWindowLight } from '../../three/textures'
import { createPaperGeometry } from '../../three/paperGeometry'
import { noteLayerDepth } from '../../three/noteLayers'
import { CONTACT_SHADOW_OPACITY } from '../../three/paperMotion'
import type { PaperMotionFrame } from '../../three/paperMotion'
import { createBakedNoteSurface } from '../../three/noteSurface'
import type { BindNoteSurface } from '../../three/noteSurface'
import { NOTE_HEIGHT, NOTE_WIDTH, WALL_HEIGHT, WALL_WIDTH } from '../../utils/constants'
import { StickyNote } from '../sticky-note/StickyNote'
import type { StickyNoteData } from '../../types/wall'
import { hasWallFilters, matchesFilters } from '../../utils/noteSearch'
import { SECTION_HEIGHT, SECTION_WIDTH } from '../../utils/wallSections'
import { SectionMarker } from './SectionMarker'

function noteTransformsChanged(previous: StickyNoteData[] | null, notes: StickyNoteData[]) {
  if (!previous || previous.length !== notes.length) return true
  return notes.some((note, index) => {
    const before = previous[index]
    return before.id !== note.id || before.rotation !== note.rotation ||
      before.position[0] !== note.position[0] || before.position[1] !== note.position[1] ||
      before.size?.[0] !== note.size?.[0] || before.size?.[1] !== note.size?.[1]
  })
}

export function Wall({ group, prototypeSurface, reducedMotion = false }: { group: RefObject<Group | null>; prototypeSurface?: BindNoteSurface | null; reducedMotion?: boolean }) {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const allNotes = useWallStore((s) => s.notes)
  const notes = useMemo(() => allNotes.filter((note) => !note.archived), [allNotes])
  const sections = useWallStore((s) => s.sections)
  const filters = useWallStore((s) => s.filters)
  const today = useWallStore((s) => s.filters.due === 'any' ? '' : s.today)
  const editingId = useWallStore((s) => hasWallFilters(s.filters) ? s.editingId : null)
  const visibleNotes = useMemo(() => hasWallFilters(filters)
    ? notes.filter((note) => note.id === editingId || matchesFilters(note, filters, today))
    : notes, [notes, filters, editingId, today])
  const visibleIds = useMemo(() => new Set(visibleNotes.map(({ id }) => id)), [visibleNotes])
  const previousNotes = useRef<{ all: StickyNoteData[]; visible: StickyNoteData[] } | null>(null)
  const rotation = useWallStore((s) => s.wallRotation)
  const targetTilt = MathUtils.degToRad(rotation[0])
  const targetTurn = MathUtils.degToRad(rotation[1])
  const bakedSurface = useMemo(createBakedNoteSurface, [])
  const plaster = useMemo(createPlasterTexture, [])
  const windowLight = useMemo(createWindowLight, [])
  const paperGeometry = useMemo(createPaperGeometry, [])
  const sectionGeometry = useMemo(() => new PlaneGeometry(SECTION_WIDTH, SECTION_HEIGHT), [])
  const paperMotions = useMemo(() => new Set<PaperMotionFrame>(), [])
  const contactGeometry = useMemo(() => new PlaneGeometry(NOTE_WIDTH + 0.5, NOTE_HEIGHT + 0.5), [])
  const contactMaterial = useMemo(() => new MeshBasicMaterial({ map: createContactShadow(), opacity: CONTACT_SHADOW_OPACITY, transparent: true, depthWrite: false, toneMapped: false }), [])
  useEffect(() => () => { plaster.dispose(); windowLight.dispose() }, [plaster, windowLight])
  useEffect(() => () => {
    paperGeometry.dispose()
    sectionGeometry.dispose()
    contactGeometry.dispose()
    contactMaterial.map?.dispose()
    contactMaterial.dispose()
  }, [paperGeometry, sectionGeometry, contactGeometry, contactMaterial])
  useEffect(() => {
    const previous = previousNotes.current
    if (noteTransformsChanged(previous?.all ?? null, notes) || noteTransformsChanged(previous?.visible ?? null, visibleNotes)) {
      gl.shadowMap.needsUpdate = true
      invalidate()
    }
    previousNotes.current = { all: notes, visible: visibleNotes }
  }, [gl, invalidate, notes, visibleNotes])
  useEffect(() => { invalidate() }, [invalidate, targetTilt, targetTurn, reducedMotion])
  useEffect(() => {
    const canvas = gl.domElement
    const refreshShadows = () => { gl.shadowMap.needsUpdate = true; invalidate() }
    canvas.addEventListener('webglcontextrestored', refreshShadows)
    return () => canvas.removeEventListener('webglcontextrestored', refreshShadows)
  }, [gl, invalidate])
  useFrame((_, delta) => {
    for (const step of paperMotions) if (!step(delta)) paperMotions.delete(step)
    if (paperMotions.size) invalidate()
    const angle = group.current?.rotation
    if (!angle || (angle.x === targetTilt && angle.y === targetTurn) || useWallStore.getState().draggingId) return
    angle.x = reducedMotion || Math.abs(angle.x - targetTilt) < 0.0001 ? targetTilt : MathUtils.damp(angle.x, targetTilt, 7, delta)
    angle.y = reducedMotion || Math.abs(angle.y - targetTurn) < 0.0001 ? targetTurn : MathUtils.damp(angle.y, targetTurn, 7, delta)
    gl.shadowMap.needsUpdate = true
    // Let the camera recheck the final wall angle on the following frame.
    invalidate()
  })

  return (
    <group ref={group} name="wall-and-attached-notes">
      <mesh receiveShadow position={[0, 0, -0.19]} name="solid-plaster-wall"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerOver={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); useWallStore.getState().select(null) }}>
        <boxGeometry args={[WALL_WIDTH, WALL_HEIGHT, 0.38]} />
        <meshStandardMaterial color="#f7f3eb" roughness={0.98} bumpMap={plaster} bumpScale={0.013} />
      </mesh>
      <mesh position={[5.6, -0.8, 0.003]} raycast={() => null}>
        <planeGeometry args={[WALL_WIDTH - 2 * 5.6, 19]} />
        <meshBasicMaterial map={windowLight} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      {sections.map((section) => <SectionMarker key={section.id} section={section} geometry={sectionGeometry} />)}
      {notes.map((note, index) => <StickyNote key={note.id} note={note} visible={visibleIds.has(note.id)} depth={noteLayerDepth(index)} paperGeometry={paperGeometry}
        contactGeometry={contactGeometry} contactMaterial={contactMaterial} paperMotions={paperMotions} bindSurface={prototypeSurface ?? bakedSurface} />)}
    </group>
  )
}
