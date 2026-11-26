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

export default memo(function WallScene({ editorElement }: { editorElement: HTMLDivElement | null }) {
  const mode = useWallStore((s) => s.mode)
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

  return <div className={`wall-scene photo-workspace mode-${mode}`} aria-label="Interactive sticky-note wall in Professor’s Study">
    <picture className="photo-workspace-plate" aria-hidden="true">
      <source media="(max-width: 560px) and (max-aspect-ratio: 51/100)" srcSet="/environments/professors-study-mobile.jpg" />
      <source media="(max-width: 560px) and (max-aspect-ratio: 13/20)" srcSet="/environments/professors-study-portrait.jpg" />
      <source media="(max-aspect-ratio: 3/5)" srcSet="/environments/professors-study-portrait.jpg" />
      <source media="(max-aspect-ratio: 1/1)" srcSet="/environments/professors-study-tablet.jpg" />
      <img src="/environments/professors-study-wide.jpg" alt="" draggable={false} fetchPriority="high"
        onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
        onLoad={(event) => { event.currentTarget.style.visibility = 'visible' }} />
    </picture>
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
      <hemisphereLight args={['#fffbf3', '#d4bca0', 1.37]} />
      <directionalLight position={[-5, 8, 12]} color="#fffdf8" intensity={2.05} />
      <Wall group={wall} prototypeSurface={prototypeSurface} phone={phone} studyOpening={phone ? studyOpening : null} />
      <PhotoCameraRig phone={phone} reducedMotion={reducedMotion} onStudyOpening={setStudyOpening} />
      <NoteEditorPosition wall={wall} element={editorElement} />
    </Canvas> : <WallLoading />}
  </div>
})
