import {
  BufferGeometry, CatmullRomCurve3, Color, Float32BufferAttribute,
  LatheGeometry, SphereGeometry, TubeGeometry, Vector2, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

type Point = [number, number, number]

export function pottery(profile: [number, number][], position: Point) {
  return new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), 24).translate(...position)
}

function tint(geometry: BufferGeometry, color: Color, highlight?: Color) {
  const positions = geometry.attributes.position
  const colors = new Float32Array(positions.count * 3)
  for (let i = 0; i < positions.count; i++) {
    const value = highlight && i === positions.count - 1 ? highlight : color
    value.toArray(colors, i * 3)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry
}

function leafGeometry() {
  const landmarks = [
    [0, 0, 0], [-0.24, 0.12, 0.005], [-0.36, 0.37, -0.01], [-0.23, 0.69, -0.025],
    [0, 1, -0.08], [0.24, 0.7, -0.025], [0.34, 0.37, -0.01], [0.23, 0.12, 0.005],
  ].map(([x, y, z]) => new Vector3(x, y, z))
  const contour = new CatmullRomCurve3(landmarks, true).getPoints(20).slice(0, -1)
  const count = contour.length
  const vertices = [...contour, new Vector3(0, 0.41, 0.105)]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices.flatMap(({ x, y, z }) => [x, y, z]), 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(vertices.flatMap(({ x, y }) => [x + 0.5, y]), 2))
  geometry.setIndex(Array.from({ length: count }, (_, i) => [(i + 1) % count, i, count]).flat())
  geometry.computeVertexNormals()
  return geometry
}

export function plantLeaves([x, y, z]: Point, scale: number) {
  let seed = 2069
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const leaf = leafGeometry()
  const base = new Vector3(x, y, z)
  const branches: Point[] = [
    [-1.42, 2.06, -0.27], [-0.64, 2.62, 0.23], [0.58, 2.25, -0.48], [1.6, 1.64, -0.29],
    [-1.74, 0.99, 0.65], [1.51, 0.98, 0.72], [-1.38, -2.4, 1.26], [0.86, -3.93, 1.45], [1.49, -2.93, 1.1],
  ]
  const leafTones = ['#3c592d', '#546f39', '#476734', '#6b8147', '#335429']
  const stemColor = new Color('#596b3d')
  const ridge = new Color('#799451')
  const shapes: BufferGeometry[] = []
  for (const [dx, dy, dz] of branches) {
    const end = base.clone().add(new Vector3(dx, dy, dz).multiplyScalar(scale))
    const trail = dy < 0
    const sweep = base.clone().add(new Vector3(dx * 0.7, trail ? 0.48 : dy * 0.68, dz * 0.5).multiplyScalar(scale))
    const curve = new CatmullRomCurve3([base, sweep, end])
    shapes.push(tint(new TubeGeometry(curve, 12, 0.04 * scale, 5), stemColor))
    for (let i = 0; i < (trail ? 9 : 7); i++) {
      const t = 0.28 + i * (trail ? 0.079 : 0.107)
      const origin = curve.getPoint(t)
      const spread = i % 2 === 0 ? 1 : -1
      const size = (0.76 + random() * 0.41) * scale * (1 - Math.max(0, t - 0.63) * 0.61)
      const color = new Color(leafTones[Math.floor(random() * leafTones.length)])
      const part = tint(leaf.clone(), color, color.clone().lerp(ridge, 0.33))
      part.scale(size, size, size)
      part.rotateX((random() - 0.5) * 1.3)
      part.rotateY((random() - 0.5) * 0.9)
      part.rotateZ(spread * (trail ? 1.45 + random() * 0.7 : 0.55 + random() * 0.86))
      shapes.push(part.translate(origin.x, origin.y, origin.z))
    }
  }
  const merged = mergeGeometries(shapes)!
  shapes.forEach((shape) => shape.dispose())
  leaf.dispose()
  return merged
}

export function globeSurface([x, y, z]: Point) {
  const globe = new SphereGeometry(0.89, 32, 20)
  const { position } = globe.attributes
  const colors = new Float32Array(position.count * 3)
  const sea = new Color('#9b8058')
  const land = new Color('#c3a579')
  for (let i = 0; i < position.count; i++) {
    const latitude = Math.asin(Math.max(-1, Math.min(1, position.getY(i) / 0.89)))
    const longitude = Math.atan2(position.getZ(i), position.getX(i))
    const outline = Math.sin(longitude * 2.8 + Math.cos(latitude * 3)) + Math.sin(latitude * 5.3 - longitude * 2)
    const tint = outline + Math.cos(longitude * 6.7 + latitude * 9) * 0.28 > 0.47 ? land : sea
    tint.toArray(colors, i * 3)
  }
  globe.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return globe.rotateZ(-0.35).translate(x, y, z)
}

