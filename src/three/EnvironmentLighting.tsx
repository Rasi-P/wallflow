import { useEffect, useMemo } from 'react'
import type { RefObject } from 'react'
import { Object3D } from 'three'
import type { DirectionalLight, SpotLight } from 'three'
import { useWallStore } from '../stores/wallStore'
import { environmentLighting } from '../utils/appearance'
import { STUDY_KEY_POSITION, STUDY_WINDOW_LIGHT, studyRoomLighting } from './environments/studyRoomLayout'
import { createWindowLightMask } from './environments/studyRoomMaterials'
import { OFFICE_KEY_POSITION, officeWhiteboardLighting } from './environments/officeWhiteboardLayout'

function StudyWindowLight({ color, intensity, light }: {
  color: string; intensity: number; light: RefObject<SpotLight | null>
}) {
  const mask = useMemo(createWindowLightMask, [])
  const target = useMemo(() => {
    const point = new Object3D()
    point.position.set(...STUDY_WINDOW_LIGHT.target)
    return point
  }, [])
  useEffect(() => () => mask.dispose(), [mask])
  return <>
    <primitive object={target} />
    <spotLight ref={light} position={STUDY_WINDOW_LIGHT.position} target={target} angle={STUDY_WINDOW_LIGHT.angle}
      distance={STUDY_WINDOW_LIGHT.range} penumbra={0.22} intensity={intensity} color={color} map={mask} />
  </>
}

function OfficeCeilingLights({ intensity }: { intensity: number }) {
  const lights = useMemo(() => [-5.6, 6.9].map((x) => {
    const target = new Object3D()
    target.position.set(x, 7.7, -0.15)
    return { x, target }
  }), [])
  return lights.map(({ x, target }) => <group key={x}>
    <primitive object={target} />
    <spotLight position={[x, 15.46, 4.6]} target={target} color="#fff0de"
      intensity={intensity} angle={0.49} penumbra={0.91} distance={21} />
  </group>)
}

export function EnvironmentLighting({ studyRoom, office, roomSun, studyWindow }: {
  studyRoom: boolean; office: boolean; roomSun: RefObject<DirectionalLight | null>; studyWindow: RefObject<SpotLight | null>
}) {
  const appearance = useWallStore((s) => s.appearance)
  const lighting = useWallStore((s) => s.lighting)
  const daylight = studyRoom ? studyRoomLighting(appearance, lighting) : null
  const palette = daylight ?? (office ? officeWhiteboardLighting(appearance, lighting) : environmentLighting(appearance, lighting))
  const roomLighting = studyRoom || office

  return <>
    <color attach="background" args={[palette.background]} />
    <ambientLight intensity={palette.ambient} color={palette.ambientColor} />
    <hemisphereLight color={palette.sky} groundColor={palette.ground} intensity={palette.hemisphere} />
    <directionalLight ref={roomLighting ? roomSun : undefined}
      position={office ? OFFICE_KEY_POSITION : studyRoom ? STUDY_KEY_POSITION : [-5, 8, 10]} intensity={palette.key} color={palette.keyColor} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={office ? -34 : roomLighting ? -29 : -19} shadow-camera-right={office ? 34 : roomLighting ? 29 : 19}
      shadow-camera-top={roomLighting ? 19 : 15} shadow-camera-bottom={roomLighting ? -27 : -15}
      shadow-camera-near={0.1} shadow-camera-far={roomLighting ? 82 : 45}
      shadow-bias={-0.00005} shadow-normalBias={0.015} shadow-radius={roomLighting ? 6.5 : 5}
      shadow-intensity={office ? 0.66 : studyRoom ? 0.75 : 1} />
    {studyRoom
      ? <pointLight position={[-16, 6, 9]} intensity={palette.fill * 115} color={palette.fillColor} />
      : <directionalLight position={[8, -3, 7]} intensity={palette.fill} color={palette.fillColor} />}
    {daylight && <StudyWindowLight color={daylight.windowColor} intensity={daylight.windowIntensity} light={studyWindow} />}
    {office && <OfficeCeilingLights intensity={palette.key * 47} />}
  </>
}
