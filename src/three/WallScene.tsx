import { memo, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import type { Group } from 'three'
import type { BindNoteSurface } from './noteSurface'
import { Wall } from '../components/wall/Wall'
import { useWallStore } from '../stores/wallStore'
import type { StudyOpening } from './mobileStudyFrame'
import { PhotoCameraRig, photoCameraOptions } from './PhotoCameraRig'
import { NOTE_TEXTURE_SIZE } from './textures'
import { NoteEditorPosition } from './NoteEditorPosition'
import { WallLoading } from '../components/ui/WallLoading'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useStudyPhone } from '../hooks/useStudyPhone'
import type { PhotoWorkspace } from '../types/wall'
import { PHOTO_WORKSPACES } from '../utils/photoWorkspaces'

const paperLighting: Record<PhotoWorkspace, [string, string, number]> = {
  professor: ['#fffbf3', '#d4bca0', 1.37],
  teacher: ['#fffdf9', '#ddd1bd', 1.37],
  scientist: ['#fcfdff', '#c5c8c8', 1.37],
}

// Normalized bounds of the clear plaster in each edge-to-edge phone photograph.
const phonePlaster: Partial<Record<PhotoWorkspace, StudyOpening>> = {
  teacher: { left: 0.137, right: 0.905, top: 0.195, bottom: 0.78 },
  scientist: { left: 0.115, right: 0.89, top: 0.195, bottom: 0.76 },
}

function PhotoBackdrop({ workspace }: { workspace: PhotoWorkspace }) {
  const [failed, setFailed] = useState(false)
  const photo = failed ? 'professor' : workspace
  const base = `/environments/${PHOTO_WORKSPACES[photo].asset}`
  return <picture key={photo} className="photo-workspace-plate" data-photo={photo} aria-hidden="true">
    {photo === 'professor' ? <>
      <source media="(max-width: 560px) and (max-aspect-ratio: 51/100)" srcSet={`${base}-mobile.jpg`} />
      <source media="(max-width: 560px) and (max-aspect-ratio: 13/20)" srcSet={`${base}-portrait.jpg`} />
      <source media="(max-aspect-ratio: 3/5)" srcSet={`${base}-portrait.jpg`} />
    </> : <source media="(max-width: 560px) and (orientation: portrait)" srcSet={`${base}-phone.jpg`} />}
    <source media="(max-aspect-ratio: 1/1)" srcSet={`${base}-tablet.jpg`} />
    {photo !== 'professor' && <source media="(max-aspect-ratio: 7/5)" srcSet={`${base}-tablet-wide.jpg`} />}
    <img src={`${base}-wide.jpg`} alt="" draggable={false} fetchPriority="high"
      onError={(event) => {
        if (photo !== 'professor') setFailed(true)
        else event.currentTarget.style.visibility = 'hidden'
      }}
      onLoad={(event) => { event.currentTarget.style.visibility = 'visible' }} />
  </picture>
}

export default memo(function WallScene({ editorElement }: { editorElement: HTMLDivElement | null }) {
  const mode = useWallStore((s) => s.mode)
  const workspace = useWallStore((s) => s.appearance.photoWorkspace ?? 'professor')
  const phone = useStudyPhone()
  const wall = useRef<Group>(null)
  const [ready, setReady] = useState(false)
  const [studyOpening, setStudyOpening] = useState<StudyOpening | null>(null)
  const [prototypeSurface, setPrototypeSurface] = useState<BindNoteSurface | null>(null)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    let active = true
    async function prepare() {
      await document.fonts?.ready
      if (new URLSearchParams(window.location.search).get('noteRendering') === 'paper-ink') {
        try {
          const { createPaperInkSurface } = await import('./prototypes/paperInkSurface')
          if (active) setPrototypeSurface(createPaperInkSurface)
        } catch (error) {
          console.warn('Could not load paper and ink rendering. Using baked notes.', error)
        }
      }
      if (active) setReady(true)
    }
    void prepare()
    return () => { active = false }
  }, [])

  return <div className={`wall-scene photo-workspace mode-${mode}`} aria-label={`Interactive sticky-note wall in ${PHOTO_WORKSPACES[workspace].name}`}>
    <PhotoBackdrop key={workspace} workspace={workspace} />
    {ready ? <Canvas style={{ position: 'absolute', inset: 0 }} orthographic frameloop="demand" flat camera={photoCameraOptions} dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        if (!prototypeSurface) return
        if (gl.capabilities.maxTextureSize < NOTE_TEXTURE_SIZE) {
          setPrototypeSurface(null)
          return
        }
        const previous = gl.debug.onShaderError
        gl.debug.onShaderError = (context, program, vertex, fragment) => {
          gl.debug.onShaderError = previous
          setPrototypeSurface(null)
          console.warn('Paper and ink shader failed. Using baked notes.', gl.getContext().getProgramInfoLog(program))
          previous?.(context, program, vertex, fragment)
        }
      }}
      onPointerMissed={() => useWallStore.getState().select(null)}
      fallback={<div className="webgl-fallback"><h2>Your wall needs WebGL.</h2><p>Open WALLFLOW in a browser with hardware acceleration enabled.</p></div>}>
      <hemisphereLight args={paperLighting[workspace]} />
      <directionalLight position={[-5, 8, 12]} color={workspace === 'scientist' ? '#fafdff' : '#fffdf8'} intensity={2.05} />
      <Wall group={wall} prototypeSurface={prototypeSurface} phone={phone} studyOpening={phone ? studyOpening : null} workspace={workspace} />
      <PhotoCameraRig phone={phone} plaster={phonePlaster[workspace]} reducedMotion={reducedMotion} onStudyOpening={setStudyOpening} />
      <NoteEditorPosition wall={wall} element={editorElement} />
    </Canvas> : <WallLoading />}
  </div>
})
