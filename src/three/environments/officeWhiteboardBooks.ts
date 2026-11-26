import { Color, CylinderGeometry, Float32BufferAttribute } from 'three'
import type { BufferGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { OFFICE_ROOM } from './officeWhiteboardLayout.ts'

type Edition = readonly [thickness: number, height: number, depth: number, cloth: string]

function volume(edition: Edition, x: number, bottom: number, z: number, yaw: number, laidFlat = false) {
  const [thickness, height, depth, cloth] = edition
  const board = Math.min(thickness * 0.19, 0.067)
  const cover: BufferGeometry[] = [-1, 1].map((side) => new RoundedBoxGeometry(board, height, depth, 1, 0.024)
    .translate(side * (thickness - board) / 2, 0, 0))
  const spineBlank = new CylinderGeometry(1, 1, height, 12, 1, true, -Math.PI / 2, Math.PI)
  cover.push(spineBlank.toNonIndexed()
    .scale(thickness / 2, 1, 0.092 + thickness * 0.035).translate(0, 0, depth / 2 - 0.005))
  spineBlank.dispose()
  const jacket = mergeGeometries(cover)!
  cover.forEach((piece) => piece.dispose())
  const tint = new Color(cloth)
  const colors = new Float32Array(jacket.attributes.position.count * 3)
  for (let i = 0; i < jacket.attributes.position.count; i++) tint.toArray(colors, i * 3)
  jacket.setAttribute('color', new Float32BufferAttribute(colors, 3))
  const pages = new RoundedBoxGeometry(thickness - 2 * board + 0.016, height - 0.16, depth - 0.145, 1, 0.029)
    .translate(0, 0, 0.015)
  const stamp = new RoundedBoxGeometry(thickness * 0.48, thickness > 0.8 ? 0.38 : 0.10, 0.022, 1, 0.009)
    .translate(0, height * 0.24, depth / 2 + 0.084 + thickness * 0.035)
  // Sink the small cover stamps into the convex spine and land stacked volumes on their outer covers.
  const placed = (geometry: BufferGeometry) => geometry.rotateZ(laidFlat ? Math.PI / 2 : 0)
    .rotateY(yaw).translate(x, bottom + (laidFlat ? thickness : height) / 2, z)
  return { jacket: placed(jacket), pages: placed(pages), stamp: placed(stamp) }
}

const middleEditions: Edition[] = [
  [0.68, 3.55, 2.08, '#63726d'],
  [0.41, 2.53, 1.71, '#b0a493'],
  [0.74, 3.87, 2.39, '#59544e'],
  [0.46, 3.33, 1.97, '#807567'],
  [0.58, 2.87, 1.82, '#89958e'],
]
const upperEditions: Edition[] = [
  [0.55, 2.93, 1.84, '#b5aa94'],
  [0.73, 4.23, 2.33, '#565551'],
  [0.46, 3.49, 2.04, '#8c7b65'],
  [0.61, 3.13, 1.89, '#6d7d77'],
]

export function officeBooks(shelfTops: readonly [number, number, number]) {
  const upright = (editions: Edition[], left: number, bottom: number, z: number) => {
    let next = left
    return editions.map((edition, index) => {
      const thickness = edition[0]
      const placed = volume(edition, next + thickness / 2, bottom, z + (index % 3 - 1) * 0.08,
        [0, 0.029, -0.024][index % 3])
      next += thickness + [0.12, 0.16, 0.11][index % 3]
      return placed
    })
  }
  const { cabinet, table } = OFFICE_ROOM
  const bottom = upright([[0.87, 4.32, 2.38, '#4d514f'], [0.9, 4.01, 2.25, '#666a65']],
    cabinet.right - 2.95, shelfTops[0], 1.18)
  const middle = [
    ...upright(middleEditions, cabinet.left + 1.02, shelfTops[1], 1.16),
    volume([0.40, 3.46, 2.12, '#a79379'], cabinet.right - 2.72, shelfTops[1], 1.22, -0.11, true),
    volume([0.32, 3.03, 1.88, '#727d75'], cabinet.right - 2.51, shelfTops[1] + 0.40, 1.13, 0.075, true),
  ]
  const upper = upright(upperEditions, cabinet.left + 1.19, shelfTops[2], 1.11)
  const notebook = volume([0.25, 3.04, 2.14, '#4e5d58'], 0.56, table.top, 14.9, -0.12, true)
  return { shelves: [bottom, middle, upper], notebook }
}
