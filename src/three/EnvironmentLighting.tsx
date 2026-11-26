import { useEffect, useMemo } from 'react'
import { Object3D } from 'three'
import { useWallStore } from '../stores/wallStore'
import { environmentLighting } from '../utils/appearance'
import { STUDY_WINDOW_LIGHT, studyRoomLighting } from './environments/studyRoomLayout'
import { createWindowLightMask } from './environments/studyRoomMaterials'

function StudyWindowLight({ color, intensity }: { color: string; intensity: number }) {
  const mask = useMemo(createWindowLightMask, [])
  const target = useMemo(() => {
    const point = new Object3D()
    point.position.set(...STUDY_WINDOW_LIGHT.target)
    return point
  }, [])
  useEffect(() => () => mask.dispose(), [mask])
  return <>
    <primitive object={target} />
    <spotLight position={STUDY_WINDOW_LIGHT.position} target={target} angle={STUDY_WINDOW_LIGHT.angle}
      distance={STUDY_WINDOW_LIGHT.range} penumbra={0.22} intensity={intensity} color={color} map={mask} />
  </>
}

export function EnvironmentLighting({ studyRoom }: { studyRoom: boolean }) {
  const appearance = useWallStore((s) => s.appearance)
  const lighting = useWallStore((s) => s.lighting)
  const daylight = studyRoom ? studyRoomLighting(appearance, lighting) : null
  const palette = daylight ?? environmentLighting(appearance, lighting)

  return <>
    <color attach="background" args={[palette.background]} />
    <ambientLight intensity={palette.ambient} color={palette.ambientColor} />
    <hemisphereLight color={palette.sky} groundColor={palette.ground} intensity={palette.hemisphere} />
    <directionalLight position={studyRoom ? [-23, 16, 25] : [-5, 8, 10]} intensity={palette.key} color={palette.keyColor} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={studyRoom ? -29 : -19} shadow-camera-right={studyRoom ? 29 : 19}
      shadow-camera-top={studyRoom ? 19 : 15} shadow-camera-bottom={studyRoom ? -27 : -15}
      shadow-camera-near={0.1} shadow-camera-far={studyRoom ? 82 : 45}
      shadow-bias={-0.00005} shadow-normalBias={0.015} shadow-radius={studyRoom ? 6.5 : 5}
      shadow-intensity={studyRoom ? 0.75 : 1} />
    {studyRoom
      ? <pointLight position={[-16, 6, 9]} intensity={palette.fill * 115} color={palette.fillColor} />
      : <directionalLight position={[8, -3, 7]} intensity={palette.fill} color={palette.fillColor} />}
    {daylight && <StudyWindowLight color={daylight.windowColor} intensity={daylight.windowIntensity} />}
  </>
}
