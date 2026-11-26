import {
  BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute,
  Matrix4, Quaternion, Shape, SphereGeometry, TorusGeometry, TubeGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { OFFICE_ROOM } from './officeWhiteboardLayout.ts'
import { globeSurface, pottery } from './studyRoomProps.ts'

type Point = [number, number, number]

function mergeParts(parts: BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!
  parts.forEach((part) => part.dispose())
  return geometry
}

function upholsteredCushion(back: boolean) {
  const geometry = new SphereGeometry(1, 36, 24)
  const { position, uv } = geometry.attributes
  const colors = new Float32Array(position.count * 3)
  const fabric = new Color(back ? '#b9afa4' : '#c3b9ad')
  const welt = fabric.clone().multiplyScalar(0.84)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    const radius = Math.hypot(x, y)
    const roundness = radius === 0 ? 1 : radius / Math.hypot(x * x, y * y) ** 0.5
    const taper = back ? 0.93 + y * 0.11 : 0.99 + y * 0.067
    const curvedX = x * roundness * taper * (back ? 2.12 : 2.33)
    const curvedY = y * roundness * (back ? 1.96 : 2.22)
    const loft = Math.sign(z) * Math.abs(z) ** 0.59 * (back ? 0.25 : 0.31)
    // The upholstered shell wraps around the sitter; the seat has a flatter center and a rolled front edge.
    const contour = back ? -0.38 * (curvedX / 2.12) ** 2 : -0.09 * (1 - x * x) - 0.105 * Math.max(0, y)
    position.setXYZ(i, curvedX, curvedY, loft + contour)
    uv.setXY(i, curvedX * 0.43, curvedY * 0.43)
    const tint = Math.abs(z) < 0.075 ? welt : fabric
    tint.toArray(colors, i * 3)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
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
    { x: -20.18, z: 14.35, turn: -1.38, foreground: false },
    { x: 20.85, z: 14.55, turn: 1.38, foreground: false },
    { x: -7.75, z: 25.04, turn: -0.10, foreground: true },
    { x: 8.3, z: 25.19, turn: 0.08, foreground: true },
  ]
  const back = upholsteredCushion(true).rotateX(0.15).translate(0, 6.25, 1.76)
  const seat = upholsteredCushion(false).rotateX(-Math.PI / 2).translate(0, 4.46, -0.04)
  const supportParts = [-1, 1].flatMap((side) => [
    ...[-1, 1].map((end) => bar(new Vector3(side * 2.08, 0.018, end * 1.87),
      new Vector3(side * 1.6, 4.27, end * 1.46), 0.14)),
    bar(new Vector3(side * 1.61, 4.17, -1.48), new Vector3(side * 1.61, 4.17, 1.54), 0.15),
    bar(new Vector3(side * 1.52, 4.13, 1.45), new Vector3(side * 1.3, 5.66, 1.68), 0.125),
  ])
  const frame = mergeParts([
    ...supportParts,
    bar(new Vector3(-1.62, 4.16, 1.49), new Vector3(1.62, 4.16, 1.49), 0.13),
  ])
  const cushion = mergeGeometries([seat, back])!
  const chairs = placed.map(({ x, z, turn, foreground }) => ({
    upholstery: cushion.clone().rotateY(turn).translate(x, floor, z),
    frame: frame.clone().rotateY(turn).translate(x, floor, z),
    foreground,
  }))
  back.dispose()
  seat.dispose()
  cushion.dispose()
  frame.dispose()
  return chairs
}

export const TABLETOP_THICKNESS = 0.56

export function conferenceTabletop() {
  const { table } = OFFICE_ROOM
  const width = table.right - table.left
  const depth = table.front - table.rear
  const bevel = 0.07
  const x = width / 2 - bevel, z = depth / 2 - bevel
  const radius = 1.24
  const outline = new Shape()
  outline.moveTo(-x + radius, -z)
  outline.lineTo(x - radius, -z)
  outline.quadraticCurveTo(x, -z, x, -z + radius)
  outline.lineTo(x, z - radius)
  outline.quadraticCurveTo(x, z, x - radius, z)
  outline.lineTo(-x + radius, z)
  outline.quadraticCurveTo(-x, z, -x, z - radius)
  outline.lineTo(-x, -z + radius)
  outline.quadraticCurveTo(-x, -z, -x + radius, -z)
  const geometry = new ExtrudeGeometry(outline, {
    curveSegments: 8, depth: TABLETOP_THICKNESS - 2 * bevel, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3,
  }).rotateX(-Math.PI / 2).translate((table.left + table.right) / 2,
    table.top - TABLETOP_THICKNESS + bevel, (table.rear + table.front) / 2)
  const { position, normal, uv } = geometry.attributes
  for (let i = 0; i < position.count; i++) {
    const u = (position.getX(i) - table.left) / width
    const v = (position.getZ(i) - table.rear) / depth
    const edgeGrain = 0.32 + (position.getY(i) - table.top) * 0.17
    uv.setXY(i, Math.abs(normal.getX(i)) > 0.85 ? v : u, Math.abs(normal.getY(i)) > 0.65 ? v : edgeGrain)
  }
  return geometry
}

export function conferenceTableFrame() {
  const { table, floor } = OFFICE_ROOM
  const underside = table.top - TABLETOP_THICKNESS
  const legHeight = underside - 0.14 - floor
  const xs = [table.left + 2.85, table.right - 2.85]
  const zs = [table.rear + 2.2, table.front - 2.2]
  const centerX = (table.left + table.right) / 2
  const centerZ = (table.rear + table.front) / 2
  const plates: BufferGeometry[] = []
  const legs = xs.flatMap((x) => zs.map((z) => {
    plates.push(new RoundedBoxGeometry(1.08, 0.14, 1.18, 1, 0.035).translate(x, underside - 0.07, z))
    const leg = new RoundedBoxGeometry(0.63, legHeight, 0.68, 2, 0.057)
    const { position } = leg.attributes
    for (let i = 0; i < position.count; i++) {
      const foot = 0.5 - position.getY(i) / legHeight
      const taper = 1 - 0.21 * foot
      position.setX(i, position.getX(i) * taper + Math.sign(x - centerX) * foot * 0.33)
      position.setZ(i, position.getZ(i) * taper + Math.sign(z - centerZ) * foot * 0.22)
    }
    return leg.translate(x, floor + legHeight / 2, z)
  }))
  const aprons = zs.map((z) => new RoundedBoxGeometry(xs[1] - xs[0], 0.28, 0.36, 1, 0.05)
    .translate(centerX, underside - 0.185, z))
  return mergeParts([...legs, ...plates, ...aprons])
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

function officeLeaf() {
  const sections = 10
  const vertices: number[] = []
  const texCoords: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= sections; i++) {
    const t = i / sections
    const width = 0.008 + 0.29 * Math.sin(Math.PI * t) ** 0.86 * (1.13 - t * 0.29)
    const sag = 0.10 * Math.sin(Math.PI * t) - 0.21 * t ** 2
    vertices.push(-width, t, sag - width * 0.34, 0, t, sag, width * 0.96, t, sag - width * 0.43)
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

const plantShapes = {
  floor: { height: 6.9, reach: 1.92, depth: 0.66, leaf: 1.17, branches: 6, leaves: 4, heading: 0.36 },
  desk: { height: 0.88, reach: 0.65, depth: 0.7, leaf: 0.49, branches: 4, leaves: 3, heading: 1.27 },
  shelf: { height: 2.18, reach: 0.92, depth: 0.57, leaf: 0.76, branches: 5, leaves: 3, heading: 0.9 },
}

export function createOfficePlant(kind: keyof typeof plantShapes, [x, y, z]: Point) {
  const shape = plantShapes[kind]
  const parts: BufferGeometry[] = []
  const leaf = officeLeaf()
  const bark = new Color(kind === 'floor' ? '#77613e' : '#637244')
  const tones = ['#31552e', '#49693b', '#688449', '#3e603a', '#789052'].map((tone) => new Color(tone))
  const vein = new Color('#8b9c56')
  const vertical = new Vector3(0, 1, 0)
  const trunkRadius = kind === 'floor' ? 0.104 : 0.032
  const trunk = new CatmullRomCurve3([
    new Vector3(0, -0.025, 0), new Vector3(shape.reach * 0.12, shape.height * 0.37, -0.04),
    new Vector3(0.03, shape.height * 0.68, 0.04), new Vector3(-shape.reach * 0.13, shape.height, 0.02),
  ])
  parts.push(colored(new TubeGeometry(trunk, 18, trunkRadius, 7), bark).translate(x, y, z))
  for (let branch = 0; branch < shape.branches; branch++) {
    const level = branch / (shape.branches - 1)
    const angle = shape.heading + branch * 2.40
    const spread = shape.reach * (1 - level * 0.42)
    const root = trunk.getPoint(0.25 + level * 0.52)
    const rise = shape.height * (0.26 + level * 0.053)
    const dx = Math.cos(angle) * spread, dz = Math.sin(angle) * spread * shape.depth
    const curve = new CatmullRomCurve3([
      root,
      root.clone().add(new Vector3(dx * 0.35, rise * 0.36, dz * 0.35)),
      root.clone().add(new Vector3(dx * 0.73, rise * 0.78, dz * 0.72)),
      root.clone().add(new Vector3(dx, rise, dz)),
    ])
    parts.push(colored(new TubeGeometry(curve, 9, trunkRadius * (0.41 - level * 0.13), 5), bark).translate(x, y, z))
    for (let i = 0; i < shape.leaves; i++) {
      const t = 0.38 + i * (0.61 / (shape.leaves - 1))
      const point = curve.getPoint(t)
      const size = shape.leaf * (1.06 - t * 0.27 + 0.15 * Math.sin(branch * 6 + i * 3.1))
      const side = i % 2 === 0 ? -1 : 1
      const direction = angle + side * (0.87 - t * 0.34)
      const blade = new Vector3(Math.cos(direction), 0.1 + t * 0.25, Math.sin(direction) * shape.depth).normalize()
      const stemEnd = point.clone().addScaledVector(blade, size * 0.19)
      const aim = new Quaternion().setFromUnitVectors(vertical, blade)
      parts.push(colored(bar(point, stemEnd, trunkRadius * 0.16), bark).translate(x, y, z))
      parts.push(colored(leaf.clone(), tones[(branch * 2 + i) % tones.length], vein)
        .scale(size * (0.83 + level * 0.15), size, size).rotateY(0.57 * Math.sin(i * 2.2 + branch))
        .applyQuaternion(aim).translate(x + stemEnd.x, y + stemEnd.y, z + stemEnd.z))
    }
  }
  leaf.dispose()
  return mergeParts(parts)
}

export function shelfGlobe([x, y, z]: Point) {
  const center = y + 1.52
  const globe = globeSurface([0, 0, 0]).scale(1.18, 1.18, 1.18).translate(x, center, z)
  const axle = new Vector3(-Math.sin(0.34), Math.cos(0.34), 0).applyAxisAngle(new Vector3(0, 1, 0), -0.15)
  const mount = mergeParts([
    new TorusGeometry(1.14, 0.043, 8, 36, Math.PI * 1.56)
      .rotateZ(0.34).rotateY(-0.15).translate(x, center, z),
    pottery([[0, 0], [0.57, 0], [0.57, 0.08], [0.36, 0.16], [0.15, 0.19], [0.11, 0.46], [0, 0.46]], [x, y, z]),
    ...[-1, 1].map((side) => bar(new Vector3(x, center, z).addScaledVector(axle, side * 1.03),
      new Vector3(x, center, z).addScaledVector(axle, side * 1.16), 0.031)),
  ])
  return { globe, mount }
}
