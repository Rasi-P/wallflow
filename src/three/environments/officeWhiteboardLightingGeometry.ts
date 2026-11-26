import {
  Box2, Color, DataTexture, ExtrudeGeometry, Float32BufferAttribute, LatheGeometry, LinearFilter,
  MathUtils, Path, PlaneGeometry, Shape, Vector2,
} from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { OFFICE_DOWNLIGHT, OFFICE_ROOM } from './officeWhiteboardLayout.ts'

const { left, right, ceiling, floor } = OFFICE_ROOM

export function officeCeiling(rear: number, depth: number) {
  const outline = new Shape().moveTo(left, rear).lineTo(left, rear + depth)
    .lineTo(right, rear + depth).lineTo(right, rear).closePath()
  for (const x of OFFICE_DOWNLIGHT.locations) {
    const { z, aperture } = OFFICE_DOWNLIGHT
    outline.holes.push(new Path().absarc(x, z, aperture, 0, Math.PI * 2, false))
  }
  const thickness = 0.5
  const geometry = new ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false, curveSegments: 10 })
    .translate(0, 0, -thickness).rotateX(Math.PI / 2).translate(0, ceiling, 0)
  const { position, uv } = geometry.attributes
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const x = (position.getX(i) - left) / (right - left)
    const z = (position.getZ(i) - rear) / depth
    uv.setXY(i, x, z)
    // Low-frequency daylight variation over the matte paint, fading away from the glazing.
    const bounce = 1 - x * 0.087 - z * 0.021
    colors.set([bounce, bounce, bounce], 3 * i)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry
}

export function officeDownlightHousing(x: number) {
  const lip = OFFICE_DOWNLIGHT.aperture
  const profile = [
    [0, 0.26], [0.105, 0.26], [0.172, 0.244], [0.205, 0.198],
    [0.226, 0.142], [0.262, 0.064], [0.278, 0.009],
    [lip + 0.035, 0.002], [lip + 0.043, 0.015],
  ]
  const geometry = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 32)
  const { position } = geometry.attributes
  const rim = new Color('#d9d5cd')
  const baffle = new Color('#72695e')
  const inner = new Color('#cfb18f')
  const tint = new Color()
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    const r = Math.hypot(position.getX(i), position.getZ(i))
    if (y < 0.025 && r > 0.276) tint.copy(rim)
    else tint.copy(baffle).lerp(inner, MathUtils.smoothstep(y, 0.08, 0.26))
    tint.toArray(colors, i * 3)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry.translate(x, ceiling, OFFICE_DOWNLIGHT.z)
}

export type OfficeOcclusionPatch = {
  x: number; y: number; z: number; width: number; height: number; strength: number; surface: 'floor' | 'wall'
}

export function officeFootContacts(geometry: BufferGeometry): OfficeOcclusionPatch[] {
  const feet: Box2[] = []
  const { position } = geometry.attributes
  const point = new Vector2()
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) > floor + 0.066) continue
    point.set(position.getX(i), position.getZ(i))
    const foot = feet.find(({ min, max }) => point.x > min.x - 0.72 && point.x < max.x + 0.72 &&
      point.y > min.y - 0.72 && point.y < max.y + 0.72)
    if (foot) foot.expandByPoint(point)
    else feet.push(new Box2(point.clone(), point.clone()))
  }
  return feet.map((foot) => {
    const center = foot.getCenter(new Vector2())
    const size = foot.getSize(new Vector2())
    return { x: center.x, y: floor + 0.009, z: center.y, width: size.x + 1.12, height: size.y + 1.12,
      strength: 0.91, surface: 'floor' }
  })
}

export function officeOcclusionTexture() {
  const size = 64
  const pixels = new Uint8Array(size * size * 4)
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const radius = Math.hypot(2 * (column + 0.5) / size - 1, 2 * (row + 0.5) / size - 1)
    const alpha = Math.exp(-3.8 * radius ** 2) * (1 - MathUtils.smoothstep(radius, 0.77, 1))
    pixels.set([255, 255, 255, Math.round(255 * alpha)], (row * size + column) * 4)
  }
  const texture = new DataTexture(pixels, size, size)
  texture.minFilter = texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

export function officeOcclusionGeometry(patches: OfficeOcclusionPatch[]) {
  const parts = patches.map(({ x, y, z, width, height, strength, surface }) => {
    const stamp = new PlaneGeometry(width, height)
    if (surface === 'floor') stamp.rotateX(-Math.PI / 2)
    stamp.translate(x, y, z)
    stamp.setAttribute('color', new Float32BufferAttribute(Array.from({ length: 4 }, () => [1, 1, 1, strength]).flat(), 4))
    return stamp
  })
  const geometry = mergeGeometries(parts)!
  parts.forEach((part) => part.dispose())
  return geometry
}
