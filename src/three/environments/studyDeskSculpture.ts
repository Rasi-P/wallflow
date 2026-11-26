import {
  CatmullRomCurve3, DataTexture, EquirectangularReflectionMapping, Group, LineCurve3, LinearFilter,
  MathUtils, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector3,
} from 'three'
import type { Plane } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { STUDY_ROOM } from './studyRoomLayout.ts'
import { pottery } from './studyRoomProps.ts'

export const STUDY_SCULPTURE_PERIOD = 7.8

function brassReflections() {
  const width = 128, height = 64
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height
    const ceiling = MathUtils.smoothstep(v, 0.48, 1)
    const deskBounce = 1 - MathUtils.smoothstep(v, 0.19, 0.54)
    const lightHeight = MathUtils.smoothstep(v, 0.37, 0.43) * (1 - MathUtils.smoothstep(v, 0.72, 0.8))
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width
      // Soft window bands and desk bounce supply reflections for the small brass surfaces only.
      const pane = MathUtils.smoothstep(u, 0.13, 0.17) * (1 - MathUtils.smoothstep(u, 0.34, 0.39))
      const mullion = 1 - 0.70 * Math.exp(-(((u - 0.255) / 0.012) ** 2))
      const window = pane * lightHeight * mullion
      const diffuse = 69 + ceiling * 100
      const i = (y * width + x) * 4
      pixels.set([
        Math.min(255, diffuse + deskBounce * 60 + 142 * window),
        Math.min(255, diffuse + deskBounce * 42 + 151 * window),
        Math.min(255, diffuse + deskBounce * 28 + 159 * window),
        255,
      ], i)
    }
  }
  const map = new DataTexture(pixels, width, height)
  map.mapping = EquirectangularReflectionMapping
  map.colorSpace = SRGBColorSpace
  map.minFilter = map.magFilter = LinearFilter
  map.needsUpdate = true
  return map
}

export function buildStudyDeskSculpture(planes: Plane[]) {
  const { desk } = STUDY_ROOM
  const sculpture = new Group()
  sculpture.name = 'kinetic desk sculpture'
  sculpture.position.set(desk.right - 2.1, desk.surface, desk.front - 0.62)

  const finish = { clippingPlanes: planes, clipIntersection: true }
  const baseGeometry = pottery([
    [0, 0], [0.246, 0], [0.265, 0.024], [0.265, 0.597],
    [0.252, 0.63], [0.231, 0.64], [0, 0.64],
  ], [0, 0, 0])
  const baseMaterial = new MeshStandardMaterial({ ...finish, color: '#222120', roughness: 0.54, metalness: 0.1 })
  const reflections = brassReflections()
  const brass = new MeshPhysicalMaterial({
    ...finish, color: '#d7a14f', roughness: 0.23, metalness: 0.94, clearcoat: 0.24, clearcoatRoughness: 0.25,
    envMap: reflections, envMapIntensity: 0.98,
  })
  const pendulum = new Group()
  pendulum.name = 'brass balance pivot'
  pendulum.position.y = 0.641
  const left = new Vector3(-0.958, -0.063, 0)
  const right = new Vector3(0.958, -0.063, 0)
  const bow = new CatmullRomCurve3([
    left, new Vector3(-0.724, 0.239, 0), new Vector3(-0.387, 0.397, 0), new Vector3(0, 0.447, 0),
    new Vector3(0.387, 0.397, 0), new Vector3(0.724, 0.239, 0), right,
  ])
  const hanger = new CatmullRomCurve3([
    new Vector3(0.018, 0.009, 0), new Vector3(-0.12, 0.147, 0), new Vector3(-0.09, 0.254, 0),
    new Vector3(0, 0.366, 0), new Vector3(0.104, 0.251, 0), new Vector3(0.124, 0.147, 0),
    new Vector3(0.064, 0.075, 0),
  ])
  const stem = new LineCurve3(new Vector3(0, 0.35, 0), new Vector3(0, 0.549, 0))
  const brassParts = [
    new TubeGeometry(bow, 32, 0.019, 8, false),
    new TubeGeometry(hanger, 19, 0.016, 7, false),
    new TubeGeometry(stem, 3, 0.015, 8, false),
    new SphereGeometry(0.112, 16, 12).translate(left.x, left.y, left.z),
    new SphereGeometry(0.112, 16, 12).translate(right.x, right.y, right.z),
    new SphereGeometry(0.064, 14, 10).translate(0, 0.549, 0),
  ]
  const armGeometry = mergeGeometries(brassParts)!
  brassParts.forEach((part) => part.dispose())

  const base = new Mesh(baseGeometry, baseMaterial)
  base.name = 'stationary black sculpture base'
  const arm = new Mesh(armGeometry, brass)
  arm.name = 'curved brass arm and balancing weights'
  for (const mesh of [base, arm]) {
    mesh.raycast = () => {}
    mesh.castShadow = mesh.receiveShadow = true
  }
  pendulum.add(arm)
  sculpture.add(base, pendulum)

  function update(seconds: number) {
    const swing = Math.sin(seconds * Math.PI * 2 / STUDY_SCULPTURE_PERIOD)
    pendulum.rotation.set(0, -0.18 + swing * 0.23, swing * 0.099, 'YXZ')
  }
  update(0)

  return {
    sculpture,
    update,
    dispose() {
      baseGeometry.dispose()
      armGeometry.dispose()
      baseMaterial.dispose()
      brass.dispose()
      reflections.dispose()
    },
  }
}
