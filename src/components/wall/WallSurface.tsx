import { memo, useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { BoxGeometry, MeshStandardMaterial } from 'three'
import { useWallStore } from '../../stores/wallStore'
import { createPlasterTexture, createWindowLight } from '../../three/textures'
import type { EnvironmentTheme } from '../../types/wall'
import { THEME_PRESETS, wallFinish } from '../../utils/appearance'
import { WALL_HEIGHT, WALL_WIDTH } from '../../utils/constants'

type Trim = { x: number; y: number; width: number; height: number }
const TRIM: Record<EnvironmentTheme, Trim[]> = {
  minimal: [],
  study: [
    { x: 0, y: 5.06, width: 31.5, height: 0.14 },
    { x: 0, y: 5.17, width: 31.5, height: 0.047 },
    { x: 0, y: -9.7, width: 31.5, height: 0.28 },
  ],
  studio: [
    { x: -4.7, y: 5.04, width: 3.4, height: 0.11 },
    { x: -2.48, y: 5.04, width: 0.68, height: 0.11 },
    { x: 5.65, y: -5.24, width: 2.65, height: 0.11 },
  ],
  lab: [
    { x: 0, y: -5.06, width: 31.5, height: 0.077 },
    { x: 0, y: -5.19, width: 31.5, height: 0.04 },
  ],
}
const skipRaycast = () => null

function WallTrim({ theme }: { theme: EnvironmentTheme }) {
  const invalidate = useThree((state) => state.invalidate)
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new MeshStandardMaterial({ roughness: 0.77 }), [])

  useLayoutEffect(() => {
    const tint = THEME_PRESETS[theme].trim
    if (!tint) return
    material.color.set(tint)
    invalidate()
  }, [invalidate, material, theme])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  return <group name="environment-trim">
    {TRIM[theme].map(({ x, y, width, height }, index) =>
      // Keep the accent below the contact shadows and outside the note hit targets.
      <mesh key={index} geometry={geometry} material={material} position={[x, y, -0.002]}
        scale={[width, height, 0.012]} raycast={skipRaycast} receiveShadow />)}
  </group>
}

function LegacyWallAccents({ theme, finish }: { theme: EnvironmentTheme; finish: ReturnType<typeof wallFinish> }) {
  const windowLight = useMemo(createWindowLight, [])
  useEffect(() => () => windowLight.dispose(), [windowLight])
  return <>
    <mesh position={[5.6, -0.8, 0.003]} raycast={skipRaycast} name="window-light">
      <planeGeometry args={[WALL_WIDTH - 2 * 5.6, 19]} />
      <meshBasicMaterial map={windowLight} color={finish.windowTint} opacity={finish.windowOpacity}
        transparent depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
    </mesh>
    <WallTrim theme={theme} />
  </>
}

export const WallSurface = memo(function WallSurface() {
  const appearance = useWallStore((s) => s.appearance)
  const finish = wallFinish(appearance)
  const plaster = useMemo(createPlasterTexture, [])
  useEffect(() => () => plaster.dispose(), [plaster])

  return <>
    <mesh receiveShadow position={[0, 0, -0.19]} name="solid-plaster-wall"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerOver={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); useWallStore.getState().select(null) }}>
      <boxGeometry args={[WALL_WIDTH, WALL_HEIGHT, 0.38]} />
      <meshStandardMaterial color={finish.color} roughness={0.98} bumpMap={plaster} bumpScale={0.013} />
    </mesh>
    <LegacyWallAccents theme={appearance.theme} finish={finish} />
  </>
})
