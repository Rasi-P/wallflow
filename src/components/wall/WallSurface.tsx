import { memo, useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { BoxGeometry, MeshStandardMaterial } from 'three'
import type { Texture } from 'three'
import { useWallStore } from '../../stores/wallStore'
import { createPlasterTexture, createWindowLight } from '../../three/textures'
import type { EnvironmentTheme } from '../../types/wall'
import { THEME_PRESETS, wallFinish } from '../../utils/appearance'
import { WALL_HEIGHT, WALL_WIDTH } from '../../utils/constants'
import { createStudyPlasterBox, STUDY_BOARD_THICKNESS, STUDY_PLASTER_RELIEF } from '../../three/environments/studyRoomMaterials'
import { OFFICE_BOARD_THICKNESS, OFFICE_FRAME_WIDTH } from '../../three/environments/officeWhiteboardLayout'

type Trim = { x: number; y: number; width: number; height: number }
const TRIM: Record<EnvironmentTheme, Trim[]> = {
  minimal: [],
  office: [],
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

const officeFrame = [
  ...[-1, 1].map((side) => ({
    x: side * (WALL_WIDTH + OFFICE_FRAME_WIDTH) / 2, y: 0, width: OFFICE_FRAME_WIDTH, height: WALL_HEIGHT,
  })),
  ...[-1, 1].map((side) => ({
    x: 0, y: side * (WALL_HEIGHT + OFFICE_FRAME_WIDTH) / 2, width: WALL_WIDTH + 2 * OFFICE_FRAME_WIDTH, height: OFFICE_FRAME_WIDTH,
  })),
]

function OfficeBoardFrame() {
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new MeshStandardMaterial({
    color: THEME_PRESETS.office.trim ?? '#515452', roughness: 0.37, metalness: 0.52,
  }), [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  return <group name="whiteboard aluminum frame">
    {officeFrame.map(({ x, y, width, height }) =>
      <mesh key={`${x},${y}`} geometry={geometry} material={material} position={[x, y, -OFFICE_BOARD_THICKNESS / 2]}
        scale={[width, height, OFFICE_BOARD_THICKNESS]} raycast={skipRaycast} receiveShadow />)}
    <mesh geometry={geometry} material={material} position={[0, -WALL_HEIGHT / 2 - OFFICE_FRAME_WIDTH - 0.09, 0.035]}
      scale={[WALL_WIDTH + 0.52, 0.12, 0.38]} raycast={skipRaycast} receiveShadow />
  </group>
}

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

export const WallSurface = memo(function WallSurface({ studyPlaster }: { studyPlaster: Texture | null }) {
  const appearance = useWallStore((s) => s.appearance)
  const finish = wallFinish(appearance)
  const office = appearance.theme === 'office'
  const thickness = office ? OFFICE_BOARD_THICKNESS : studyPlaster ? STUDY_BOARD_THICKNESS : 0.38
  const geometry = useMemo(() => studyPlaster
    ? createStudyPlasterBox(WALL_WIDTH, WALL_HEIGHT, thickness)
    : new BoxGeometry(WALL_WIDTH, WALL_HEIGHT, thickness), [studyPlaster, thickness])
  const legacyBump = useMemo(() => studyPlaster || office ? null : createPlasterTexture(), [studyPlaster, office])
  useEffect(() => () => { geometry.dispose(); legacyBump?.dispose() }, [geometry, legacyBump])

  return <>
    <mesh receiveShadow castShadow={studyPlaster !== null || office} geometry={geometry} position={[0, 0, -thickness / 2]} name={office ? 'office-whiteboard' : 'solid-plaster-wall'}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerOver={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); useWallStore.getState().select(null) }}>
      <meshStandardMaterial color={finish.color} roughness={office ? 0.47 : 0.98} map={studyPlaster} bumpMap={studyPlaster ?? legacyBump}
        bumpScale={studyPlaster ? STUDY_PLASTER_RELIEF : 0.013} />
    </mesh>
    {office ? <OfficeBoardFrame /> : !studyPlaster && <LegacyWallAccents theme={appearance.theme} finish={finish} />}
  </>
})
