import { useWallStore } from '../stores/wallStore'
import { environmentLighting } from '../utils/appearance'

export function EnvironmentLighting() {
  const appearance = useWallStore((s) => s.appearance)
  const lighting = useWallStore((s) => s.lighting)
  const palette = environmentLighting(appearance, lighting)

  return <>
    <color attach="background" args={[palette.background]} />
    <ambientLight intensity={palette.ambient} color={palette.ambientColor} />
    <hemisphereLight color={palette.sky} groundColor={palette.ground} intensity={palette.hemisphere} />
    <directionalLight position={[-5, 8, 10]} intensity={palette.key} color={palette.keyColor} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-19} shadow-camera-right={19}
      shadow-camera-top={15} shadow-camera-bottom={-15} shadow-camera-near={0.1} shadow-camera-far={45}
      shadow-bias={-0.00005} shadow-normalBias={0.015} shadow-radius={5} />
    <directionalLight position={[8, -3, 7]} intensity={palette.fill} color={palette.fillColor} />
  </>
}
