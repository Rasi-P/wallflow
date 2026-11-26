import { useEffect, useMemo } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MeshBasicMaterial, PlaneGeometry } from 'three'
import type { Group } from 'three'
import { useWallStore } from '../../stores/wallStore'
import { createContactShadow } from '../../three/textures'
import { createPaperGeometry, PAPER_SHAPE_COUNT, paperShapeForId } from '../../three/paperGeometry'
import { noteLayerDepth } from '../../three/noteLayers'
import { CONTACT_SHADOW_OPACITY } from '../../three/paperMotion'
import type { PaperMotionFrame } from '../../three/paperMotion'
import { createBakedNoteSurface, keepColorEmoji } from '../../three/noteSurface'
import type { BindNoteSurface } from '../../three/noteSurface'
import { NOTE_HEIGHT, NOTE_WIDTH } from '../../utils/constants'
import { StickyNote } from '../sticky-note/StickyNote'
import { hasWallFilters, matchesFilters } from '../../utils/noteSearch'
import { SECTION_HEIGHT, SECTION_WIDTH } from '../../utils/wallSections'
import { SectionMarker } from './SectionMarker'
import { createPaperAttachments } from '../../three/paperAttachments'
import { studyNoteFitsOpening, studySectionFitsOpening } from '../../three/mobileStudyFrame'
import type { StudyOpening } from '../../three/mobileStudyFrame'
import type { PhotoWorkspace } from '../../types/wall'

export function Wall({ group, prototypeSurface, phone, studyOpening, workspace }: {
  group: RefObject<Group | null>; prototypeSurface?: BindNoteSurface | null; phone?: boolean; studyOpening: StudyOpening | null; workspace: PhotoWorkspace
}) {
  const invalidate = useThree((state) => state.invalidate)
  const allNotes = useWallStore((s) => s.notes)
  const notes = useMemo(() => allNotes.filter((note) => !note.archived), [allNotes])
  const sections = useWallStore((s) => s.sections)
  const filters = useWallStore((s) => s.filters)
  const today = useWallStore((s) => s.filters.due === 'any' ? '' : s.today)
  const editingId = useWallStore((s) => studyOpening || hasWallFilters(s.filters) ? s.editingId : null)
  const selectedId = useWallStore((s) => studyOpening ? s.selectedId : null)
  const visibleNotes = useMemo(() => {
    const filtered = hasWallFilters(filters)
      ? notes.filter((note) => note.id === editingId || matchesFilters(note, filters, today))
      : notes
    return studyOpening ? filtered.filter((note) => note.id === editingId || note.id === selectedId ||
      studyNoteFitsOpening(note, studyOpening)) : filtered
  }, [notes, filters, editingId, selectedId, studyOpening, today])
  const visibleSections = useMemo(() => studyOpening
    ? sections.filter((section) => studySectionFitsOpening(section, studyOpening)) : sections, [sections, studyOpening])
  const visibleIds = useMemo(() => new Set(visibleNotes.map(({ id }) => id)), [visibleNotes])
  const bakedSurface = useMemo(createBakedNoteSurface, [])
  const bindSurface = useMemo(() => keepColorEmoji(prototypeSurface, bakedSurface), [prototypeSurface, bakedSurface])
  const paperShapes = useMemo(() => Array.from({ length: PAPER_SHAPE_COUNT }, (_, index) => createPaperGeometry(index)), [])
  const sectionGeometry = useMemo(() => new PlaneGeometry(SECTION_WIDTH, SECTION_HEIGHT), [])
  const paperMotions = useMemo(() => new Set<PaperMotionFrame>(), [])
  const attachments = useMemo(createPaperAttachments, [])
  const contactGeometry = useMemo(() => new PlaneGeometry(NOTE_WIDTH + 0.99, NOTE_HEIGHT + 1.07), [])
  const contactMaterial = useMemo(() => new MeshBasicMaterial({ map: createContactShadow(), opacity: CONTACT_SHADOW_OPACITY, transparent: true, depthWrite: false, toneMapped: false }), [])
  useEffect(() => () => {
    paperShapes.forEach((shape) => shape.dispose())
    sectionGeometry.dispose()
    contactGeometry.dispose()
    contactMaterial.map?.dispose()
    contactMaterial.dispose()
    attachments.dispose()
  }, [paperShapes, sectionGeometry, contactGeometry, contactMaterial, attachments])
  useEffect(() => { invalidate() }, [invalidate, notes, visibleNotes, visibleSections])
  useFrame((_, delta) => {
    for (const step of paperMotions) if (!step(delta)) paperMotions.delete(step)
    if (paperMotions.size) invalidate()
  })

  return (
    <group ref={group} name="wall-and-attached-notes">
      {visibleSections.map((section) => <SectionMarker key={section.id} section={section} geometry={sectionGeometry} />)}
      {notes.map((note, index) => {
        const shape = paperShapeForId(note.id)
        const isClip = workspace !== 'professor' && shape === 0
        return <StickyNote key={note.id} note={note} visible={visibleIds.has(note.id)} depth={noteLayerDepth(index)} paperGeometry={paperShapes[shape]}
          contactGeometry={contactGeometry} contactMaterial={contactMaterial} paperMotions={paperMotions} bindSurface={bindSurface}
          phone={phone} largerInk={phone && workspace !== 'professor'}
          attachmentGeometry={attachments.geometry} attachmentMaterial={attachments.materials[isClip ? 2 : shape - 1]}
          attachmentKind={isClip ? 'clip' : shape === 1 ? 'tape' : 'pin'} />
      })}
    </group>
  )
}
