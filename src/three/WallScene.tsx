import { memo, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping, PCFShadowMap } from 'three'
import type { Group } from 'three'
import type { BindNoteSurface } from './noteSurface'
import { Wall } from '../components/wall/Wall'
import { useWallStore } from '../stores/wallStore'
import { CameraRig } from './CameraRig'
import { WALL_CAMERA_FOV } from './wallViewBounds'
import { NOTE_TEXTURE_SIZE } from './textures'
import { NoteEditorPosition } from './NoteEditorPosition'
import { WallLoading } from '../components/ui/WallLoading'
import { useReducedMotion } from '../hooks/useReducedMotion'

import { EnvironmentLighting } from './EnvironmentLighting'

export default memo(function WallScene({ editorElement }: { editorElement: HTMLDivElement | null }) {
  const mode = useWallStore((s) => s.mode)
  const wall = useRef<Group>(null)
  const [ready, setReady] = useState(false)
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

  return <div className={`wall-scene mode-${mode}`} aria-label="Interactive three-dimensional sticky note wall">
    {ready ? <Canvas frameloop="demand" shadows={{ type: PCFShadowMap, autoUpdate: false }}
      camera={{ position: [0, 0.18, 14.6], fov: WALL_CAMERA_FOV, near: 0.1, far: 110 }} dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.04 }}
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
          console.warn('Paper and ink shader failed. Using baked notes.', context.getProgramInfoLog(program))
          previous?.(context, program, vertex, fragment)
        }
      }}
      onPointerMissed={() => useWallStore.getState().select(null)}
      fallback={<div className="webgl-fallback"><h2>Your wall needs WebGL.</h2><p>Open WALLFLOW in a browser with hardware acceleration enabled.</p></div>}>
      <EnvironmentLighting />
      <Wall group={wall} prototypeSurface={prototypeSurface} reducedMotion={reducedMotion} />
      <CameraRig wall={wall} reducedMotion={reducedMotion} />
      <NoteEditorPosition wall={wall} element={editorElement} />
    </Canvas> : <WallLoading />}
  </div>
})
