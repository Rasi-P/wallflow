import {
  BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute,
  Matrix4, Quaternion, Shape, TorusGeometry, TubeGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { globeSurface, pottery } from './studyRoomProps.ts'

type Point = [number, number, number]

function mergeParts(parts: BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!
  parts.forEach((part) => part.dispose())
  return geometry
}

function chairBack() {
  const outline = new Shape()
  outline.moveTo(-1.35, -2.12)
  outline.bezierCurveTo(-2.16, -1.75, -2.44, -0.18, -2.26, 1.05)
  outline.bezierCurveTo(-2.13, 2.21, -1.13, 2.31, 0, 2.32)
  outline.bezierCurveTo(1.13, 2.31, 2.13, 2.21, 2.26, 1.05)
  outline.bezierCurveTo(2.44, -0.18, 2.16, -1.75, 1.35, -2.12)
  outline.quadraticCurveTo(0, -2.5, -1.35, -2.12)
  return new ExtrudeGeometry(outline, {
    depth: 0.23, curveSegments: 8, bevelEnabled: true, bevelSize: 0.19, bevelThickness: 0.17, bevelSegments: 3,
  }).rotateX(0.17)
}

function chairSeat() {
  const outline = new Shape()
  outline.moveTo(-1.45, -1.93)
  outline.bezierCurveTo(-2.15, -1.89, -2.26, -1.22, -2.12, 0.95)
  outline.quadraticCurveTo(-2, 1.84, -1.24, 1.9)
  outline.lineTo(1.24, 1.9)
  outline.quadraticCurveTo(2, 1.84, 2.12, 0.95)
  outline.bezierCurveTo(2.26, -1.22, 2.15, -1.89, 1.45, -1.93)
  outline.quadraticCurveTo(0, -2.07, -1.45, -1.93)
  return new ExtrudeGeometry(outline, {
    depth: 0.23, curveSegments: 8, bevelEnabled: true, bevelSize: 0.18, bevelThickness: 0.16, bevelSegments: 3,
  }).rotateX(-Math.PI / 2)
}

function bar(start: Vector3, end: Vector3, radius: number) {
  const direction = end.clone().sub(start)
  const length = direction.length()
  const orientation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize())
  return new CylinderGeometry(radius * 0.81, radius, length, 8)
    .translate(0, length / 2, 0).applyMatrix4(new Matrix4().makeRotationFromQuaternion(orientation))
    .translate(start.x, start.y, start.z)
}

export function createConferenceChairs(floor: number) {
  const placed = [
    { x: -17.6, z: 15.45, turn: -Math.PI * 0.62 },
    { x: 18.6, z: 14.45, turn: Math.PI * 0.60 },
    { x: -5.6, z: 5.3, turn: Math.PI },
    { x: -8.2, z: 24.4, turn: 0.06, foreground: true },
    { x: 8.1, z: 24.6, turn: -0.05, foreground: true },
  ]
  const back = chairBack()
  const seat = chairSeat()
  const legs: BufferGeometry[] = []
  const nearLegs: BufferGeometry[] = []
  const farSeats: BufferGeometry[] = []
  const nearSeats: BufferGeometry[] = []
  for (const { x, z, turn, foreground } of placed) {
    const upholstery = foreground ? nearSeats : farSeats
    upholstery.push(
      back.clone().translate(0, 5.72, 1.52).rotateY(turn).translate(x, floor, z),
      seat.clone().translate(0, 3.4, -0.02).rotateY(turn).translate(x, floor, z),
    )
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const supports = foreground ? nearLegs : legs
      supports.push(bar(new Vector3(side * 1.86, 0, end * 1.71), new Vector3(side * 1.51, 3.45, end * 1.18), 0.15)
        .rotateY(turn).translate(x, floor, z))
    }
  }
  back.dispose()
  seat.dispose()
  return {
    seating: mergeParts(farSeats), foreground: mergeParts(nearSeats),
    supports: mergeParts(legs), foregroundSupports: mergeParts(nearLegs),
  }
}

function colored(geometry: BufferGeometry, base: Color, tip = base) {
  const position = geometry.attributes.position
  const values = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const mix = tip === base ? base : base.clone().lerp(tip, i % 3 === 0 ? 0.7 : 0.1)
    mix.toArray(values, i * 3)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(values, 3))
  return geometry
}

function ficusLeaf() {
  const sections = 10
  const vertices: number[] = []
  const texCoords: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= sections; i++) {
    const t = i / sections
    const width = 0.018 + 0.31 * Math.sin(Math.PI * t) ** 0.9
    const sag = 0.11 * Math.sin(Math.PI * t) - 0.24 * t ** 2
    vertices.push(-width, t, sag - width * 0.36, 0, t, sag, width, t, sag - width * 0.46)
    texCoords.push(0, t, 0.5, t, 1, t)
    if (i < sections) {
      const j = i * 3
      indices.push(j, j + 1, j + 4, j, j + 4, j + 3, j + 1, j + 2, j + 5, j + 1, j + 5, j + 4)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(texCoords, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function windowPlant([x, y, z]: Point) {
  const parts: BufferGeometry[] = []
  const leaf = ficusLeaf()
  const bark = new Color('#69513b')
  const leaves = ['#36552e', '#597744', '#657d43', '#406239', '#748b43'].map((tone) => new Color(tone))
  const vein = new Color('#9aa963')
  for (let branch = 0; branch < 8; branch++) {
    const angle = branch * 2.4
    const height = 6.3 + 2.85 * Math.sin(branch * 1.98 + 1)
    const reach = 1.9 + (branch % 3) * 0.64
    const dx = Math.cos(angle) * reach, dz = Math.sin(angle) * reach * 0.73
    const curve = new CatmullRomCurve3([
      new Vector3(0, 0, 0),
      new Vector3(dx * 0.14, height * 0.52, dz * 0.25),
      new Vector3(dx * 0.57, height * 0.83, dz * 0.57),
      new Vector3(dx, height, dz),
    ])
    parts.push(colored(new TubeGeometry(curve, 12, 0.055 + (branch % 3) * 0.014, 6), bark).translate(x, y, z))
    for (let i = 0; i < 8; i++) {
      const point = curve.getPoint(0.46 + i * 0.074)
      const size = (2.09 - i * 0.075 + 0.23 * Math.sin(i * 5 + branch)) * (0.82 + 0.07 * (branch % 3))
      const side = i % 2 === 0 ? -1 : 1
      parts.push(colored(leaf.clone(), leaves[(branch + i) % leaves.length], vein)
        .scale(size, size, size).rotateX(-0.2 + 0.22 * Math.cos(branch + i))
        .rotateZ(side * (0.83 + 0.47 * Math.sin(i * 3.6))).rotateY(angle + side * 0.51)
        .translate(x + point.x, y + point.y, z + point.z))
    }
  }
  leaf.dispose()
  return mergeParts(parts)
}

export function shelfGlobe([x, y, z]: Point) {
  const center = y + 1.52
  const globe = globeSurface([0, 0, 0]).scale(1.18, 1.18, 1.18).translate(x, center, z)
  const mount = mergeParts([
    new TorusGeometry(1.14, 0.043, 8, 36, Math.PI * 1.56)
      .rotateZ(0.34).rotateY(-0.15).translate(x, center, z),
    pottery([[0, 0], [0.57, 0], [0.57, 0.08], [0.36, 0.16], [0.15, 0.19], [0.11, 0.46], [0, 0.46]], [x, y, z]),
  ])
  return { globe, mount }
}
