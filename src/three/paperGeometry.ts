import { Float32BufferAttribute, PlaneGeometry } from 'three'
import { NOTE_HEIGHT, NOTE_WIDTH } from '../utils/constants.ts'

const paperShapes = [
  { left: 0.021, right: 0.069, curl: 0.048, phase: 0 },
  { left: 0.066, right: 0.023, curl: 0.046, phase: 1.15 },
  { left: 0.036, right: 0.045, curl: 0.041, phase: 2.5 },
]
export const PAPER_SHAPE_COUNT = paperShapes.length

export function paperShapeForId(id: string) {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return (hash >>> 0) % PAPER_SHAPE_COUNT
}

export function createPaperGeometry(variant = 0) {
  const columns = 24
  const rows = 28
  const stride = columns + 1
  const thickness = 0.011
  const geometry = new PlaneGeometry(NOTE_WIDTH, NOTE_HEIGHT, columns, rows)
  const positions = geometry.attributes.position
  const shape = paperShapes[variant] ?? paperShapes[0]
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) / NOTE_WIDTH + 0.5
    const down = 0.5 - positions.getY(i) / NOTE_HEIGHT
    // The adhesive edge stays almost flush; the bottom subtly lifts from the plaster.
    const corner = shape.left * (1 - x) ** 6 + shape.right * x ** 7
    const curl = down ** 3 * (shape.curl + corner)
    const ripple = Math.sin(x * Math.PI * 2 + down * 2 + shape.phase) * 0.004 * down
    const edgeX = (2 * x - 1) ** 5 * 0.013 * Math.sin(down * 17 + 0.7 + shape.phase)
    const edgeY = (1 - 2 * down) ** 5 * 0.009 * Math.sin(x * 19 + down + shape.phase)
    positions.setXYZ(i, positions.getX(i) + edgeX, positions.getY(i) + edgeY, curl + ripple)
  }

  // A single strip follows the curved perimeter. Separate vertices keep its normals
  // from shading the paper face, and the mesh still uses the same material and draw.
  const edge: number[] = []
  for (let x = 0; x <= columns; x++) edge.push(x)
  for (let y = 1; y <= rows; y++) edge.push(y * stride + columns)
  for (let x = columns - 1; x >= 0; x--) edge.push(rows * stride + x)
  for (let y = rows - 1; y > 0; y--) edge.push(y * stride)
  const vertices = Array.from(positions.array)
  const uvs = Array.from(geometry.attributes.uv.array)
  const indices = Array.from(geometry.index!.array)
  const first = positions.count
  for (const index of edge) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index)
    vertices.push(x, y, z, x, y, z - thickness)
    const u = geometry.attributes.uv.getX(index), v = geometry.attributes.uv.getY(index)
    uvs.push(u, v, u, v)
  }
  for (let i = 0; i < edge.length; i++) {
    const a = first + i * 2
    const b = first + ((i + 1) % edge.length) * 2
    indices.push(a, b, a + 1, b, b + 1, a + 1)
  }
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(vertices.length), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
