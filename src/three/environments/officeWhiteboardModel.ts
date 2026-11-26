import {
  BoxGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Group, InstancedMesh, LinearFilter,
  Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
} from 'three'
import type { BufferGeometry, Material, Plane, Texture } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { OFFICE_ROOM } from './officeWhiteboardLayout.ts'
import { createConferenceChairs, shelfGlobe, windowPlant } from './officeWhiteboardFurnishings.ts'
import { plantLeaves, pottery } from './studyRoomProps.ts'
import { addPlantWind, animateFoliage, animateWindowView } from './environmentWind.ts'

type Coordinates = [number, number, number]
type Box = { center: Coordinates; size: Coordinates; tint?: string; turn?: number }
type OfficeTextures = { plaster: Texture; oak: Texture; sky: Texture; fabric: Texture }
const skipRaycast = () => {}
const { left, right, floor, ceiling, wallFace, window, cabinet, table } = OFFICE_ROOM
const roomDepth = 38
const roomHeight = ceiling - floor
const roomWidth = right - left
const roomX = (left + right) / 2
const windowDepth = window.front - window.rear
const windowZ = (window.rear + window.front) / 2
const windowHeight = window.head - window.sill
const windowY = (window.sill + window.head) / 2
const cabinetWidth = cabinet.right - cabinet.left
const cabinetX = (cabinet.left + cabinet.right) / 2
const cabinetHeight = cabinet.top - floor
const tableWidth = table.right - table.left
const tableDepth = table.front - table.rear
const tableZ = (table.front + table.rear) / 2
const tableX = (table.left + table.right) / 2

const box = (center: Coordinates, size: Coordinates, tint?: string, turn?: number): Box => ({ center, size, tint, turn })

function shelfLightSpill() {
  const height = 32
  const data = new Uint8Array(height * 4)
  for (let row = 0; row < height; row++) {
    const intensity = Math.round(255 * (row / (height - 1)) ** 5)
    data.set([intensity, intensity, intensity, 255], row * 4)
  }
  const texture = new DataTexture(data, 1, height)
  texture.minFilter = texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

export function buildOfficeWhiteboard(planes: Plane[], textures: OfficeTextures) {
  const room = new Group()
  room.name = 'office-whiteboard-room'
  const returns = new Group()
  const compactWall = new Group()
  const foreground = new Group()
  room.add(returns, compactWall, foreground)

  const finish = { clippingPlanes: planes, clipIntersection: true }
  const plaster = new MeshStandardMaterial({
    ...finish, color: '#ddd2c6', map: textures.plaster, bumpMap: textures.plaster, bumpScale: 0.018, roughness: 0.94,
  })
  const soffit = new MeshStandardMaterial({ ...finish, color: '#e4dad0', roughness: 0.91 })
  const flooring = new MeshStandardMaterial({ ...finish, color: '#c1b9b4', map: textures.oak, roughness: 0.75 })
  const floorBase = new MeshStandardMaterial({ ...finish, color: '#a8947e', roughness: 0.96 })
  const trim = new MeshStandardMaterial({ ...finish, color: '#474845', roughness: 0.38, metalness: 0.4 })
  const glass = new MeshPhysicalMaterial({
    ...finish, color: '#def0f7', clearcoat: 0.73, roughness: 0.18, transparent: true, opacity: 0.10, depthWrite: false, side: DoubleSide,
  })
  const outside = new MeshBasicMaterial({ ...finish, map: textures.sky, toneMapped: false })
  const motionTime = { value: 0 }
  animateWindowView(outside, motionTime)
  const oak = new MeshPhysicalMaterial({
    ...finish, color: '#f9f1ea', map: textures.oak, bumpMap: textures.oak, bumpScale: 0.025,
    roughness: 0.47, clearcoat: 0.22, clearcoatRoughness: 0.49,
  })
  const cabinetWood = new MeshStandardMaterial({
    ...finish, color: '#a9927e', map: textures.oak, bumpMap: textures.oak, bumpScale: 0.025, roughness: 0.65,
  })
  const spill = shelfLightSpill()
  const cabinetInterior = new MeshStandardMaterial({
    ...finish, color: '#a68d78', map: textures.oak, roughness: 0.77,
    emissive: '#ffe0ac', emissiveMap: spill, emissiveIntensity: 0.39,
  })
  const lacquer = new MeshStandardMaterial({ ...finish, color: '#cec3b7', roughness: 0.59 })
  const lightingStrip = new MeshBasicMaterial({ ...finish, color: '#ffe4c0', toneMapped: false })
  const metal = new MeshStandardMaterial({ ...finish, color: '#363c40', roughness: 0.53, metalness: 0.28 })
  const binders = new MeshStandardMaterial({ ...finish, roughness: 0.82 })
  const paper = new MeshStandardMaterial({ ...finish, color: '#dbdbd0', roughness: 0.96 })
  const ceramic = new MeshStandardMaterial({
    ...finish, color: '#eee4d6', bumpMap: textures.plaster, bumpScale: 0.045, roughness: 0.63,
  })
  const foliage = new MeshStandardMaterial({ ...finish, vertexColors: true, side: DoubleSide, roughness: 0.66 })
  const foliageDepth = new MeshDepthMaterial()
  animateFoliage(foliage, motionTime)
  animateFoliage(foliageDepth, motionTime)
  const cloth = new MeshPhysicalMaterial({
    ...finish, color: '#99928a', map: textures.fabric, bumpMap: textures.fabric, bumpScale: 0.015, roughness: 0.92,
    sheen: 0.32, sheenColor: '#d1c8ba', sheenRoughness: 0.74,
  })
  const globeMaterial = new MeshStandardMaterial({ ...finish, vertexColors: true, roughness: 0.6 })
  const brass = new MeshStandardMaterial({ ...finish, color: '#a68b56', metalness: 0.52, roughness: 0.37 })
  const materials = [plaster, soffit, flooring, floorBase, trim, glass, outside, oak, cabinetWood, cabinetInterior, lacquer,
    lightingStrip, metal, binders, paper, ceramic, foliage, foliageDepth, cloth, globeMaterial, brass]
  const unitBox = new BoxGeometry()
  const geometries: BufferGeometry[] = [unitBox]
  const instances: InstancedMesh[] = []
  const placement = new Object3D()
  const color = new Color()

  function placeMesh(name: string, mesh: Mesh, castsShadow = false, group = room) {
    mesh.name = name
    mesh.castShadow = castsShadow
    mesh.receiveShadow = !(mesh.material instanceof MeshBasicMaterial) && mesh.material !== glass
    mesh.raycast = skipRaycast
    group.add(mesh)
    return mesh
  }

  function boxes(name: string, material: Material, parts: Box[], castsShadow = false, group = room) {
    const mesh = new InstancedMesh(unitBox, material, parts.length)
    instances.push(mesh)
    parts.forEach(({ center, size, tint, turn }, i) => {
      placement.position.set(...center)
      placement.scale.set(...size)
      placement.rotation.y = turn ?? 0
      placement.updateMatrix()
      mesh.setMatrixAt(i, placement.matrix)
      if (tint) mesh.setColorAt(i, color.set(tint))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return placeMesh(name, mesh, castsShadow, group)
  }

  function shaped(name: string, material: Material, geometry: BufferGeometry, castsShadow = false, group = room) {
    geometries.push(geometry)
    return placeMesh(name, new Mesh(geometry, material), castsShadow, group)
  }

  function joined(name: string, material: Material, pieces: BufferGeometry[], castsShadow = true, group = room) {
    const geometry = mergeGeometries(pieces)!
    pieces.forEach((piece) => piece.dispose())
    return shaped(name, material, geometry, castsShadow, group)
  }

  function bevels(name: string, material: Material, parts: Box[], radius: number, verticalGrain = false) {
    return joined(name, material, parts.map(({ center, size, turn }) => {
      const geometry = new RoundedBoxGeometry(...size, 1, radius)
      if (verticalGrain && size[1] > size[0] && size[1] > size[2]) {
        const uv = geometry.attributes.uv
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), 1 - uv.getX(i))
      }
      return geometry.rotateY(turn ?? 0).translate(...center)
    }))
  }

  function wallSection(x0: number, x1: number, y0: number, y1: number) {
    return box([(x0 + x1) / 2, (y0 + y1) / 2, wallFace - 0.37], [x1 - x0, y1 - y0, 0.74])
  }

  boxes('warm plaster wall behind the board', plaster, [wallSection(left, right, floor, ceiling)])
  boxes('ceiling soffit and right wall', soffit, [
    box([roomX, ceiling + 0.25, roomDepth / 2 - 0.52], [roomWidth, 0.5, roomDepth]),
    box([roomX, ceiling - 0.21, 0.53], [roomWidth, 0.43, 2.05]),
    box([right + 0.18, (ceiling + floor) / 2, roomDepth / 2 - 0.52], [0.36, roomHeight, roomDepth]),
  ], false, returns)
  boxes('plaster above the compact workspace', plaster, [
    wallSection(left, right, ceiling, ceiling + 50),
  ], false, compactWall)
  boxes('oak floor base and recessed trim', floorBase, [
    box([roomX, floor - 0.16, roomDepth / 2 - 0.48], [roomWidth, 0.27, roomDepth]),
    box([roomX, floor + 0.17, wallFace + 0.08], [roomWidth, 0.34, 0.15]),
  ])
  const planks: Box[] = []
  const boardTones = ['#ffffff', '#f5f1ec', '#eae0d8', '#f9f3ea', '#f2eae1']
  for (let row = 0; row < 20; row++) {
    const offset = (row % 3) * 2.6
    for (let start = left - offset; start < right; start += 8.8) {
      const x0 = Math.max(left, start), x1 = Math.min(right, start + 8.8)
      planks.push(box([(x0 + x1) / 2, floor - 0.035, 0.47 + row * 1.9], [x1 - x0 - 0.025, 0.07, 1.878],
        boardTones[(row + Math.round((start - left) / 8.8) + boardTones.length) % boardTones.length]))
    }
  }
  boxes('staggered oak flooring', flooring, planks)

  // This wall is open left of its corner post so the glazing carries natural perspective into the foreground.
  bevels('full-height charcoal glazing frames', trim, [
    ...[window.rear + 0.16, 8.55, 18.85, 26.25, window.front - 0.17].map((z) =>
      box([left, windowY, z], [0.63, windowHeight, 0.32])),
    ...[window.sill + 0.1, -8.05, 4.6, window.head - 0.09].map((y) =>
      box([left, y, windowZ], [0.55, 0.24, windowDepth])),
  ], 0.044)
  shaped('floor-to-ceiling side glass', glass, new PlaneGeometry(windowDepth, windowHeight)
    .rotateY(Math.PI / 2).translate(left - 0.13, windowY, windowZ))
  shaped('city and treetops beyond the glazing', outside, new PlaneGeometry(67.5, 45)
    .rotateY(Math.PI / 2).translate(left - 4.5, -2.3, -7.6))

  const baseTop = cabinet.baseTop
  const shelfLevels = [baseTop, -1.91, 5.73]
  const shelfLids = [shelfLevels[1], shelfLevels[2], cabinet.top - 0.22]
  const interiorWidth = cabinetWidth - 0.84
  bevels('built-in oak uprights and open shelves', cabinetWood, [
    ...[cabinet.left + 0.22, cabinet.right - 0.22].map((x) => box([x, floor + cabinetHeight / 2, 1.26], [0.44, cabinetHeight, 3.7])),
    box([cabinetX, cabinet.top - 0.24, 1.26], [interiorWidth, 0.48, 3.69]),
    ...shelfLevels.map((y) => box([cabinetX, y - 0.12, 1.25], [interiorWidth, 0.35, 3.66])),
  ], 0.073, true)
  const doorWidth = (interiorWidth - 0.18) / 2
  bevels('lower cabinet doors', lacquer, [-1, 1].map((side) =>
    box([cabinetX + side * (doorWidth + 0.09) / 2, (baseTop + floor) / 2 + 0.07, cabinet.front - 0.15],
      [doorWidth, baseTop - floor - 0.63, 0.26])), 0.043)
  boxes('oak cabinet backs with local light spill', cabinetInterior, shelfLevels.map((y, i) =>
    box([cabinetX, (y + shelfLids[i]) / 2, -0.25], [interiorWidth, shelfLids[i] - y, 0.18])))
  boxes('warm under-shelf strip lights', lightingStrip, shelfLids.map((y) =>
    box([cabinetX, y - 0.323, 1.52], [interiorWidth - 0.34, 0.052, 0.115])))
  joined('recessed ceiling light lenses', lightingStrip, [-5.6, 6.9].map((x) =>
    new CylinderGeometry(0.34, 0.35, 0.046, 20).translate(x, ceiling - 0.027, 4.6)), false, returns)

  const spineColors = ['#302f30', '#524e45', '#d1c1ad', '#777367', '#b1a597', '#403d3c']
  const spines: Box[] = []
  const labels: Box[] = []
  for (const row of [1, 2]) {
    let x = cabinet.left + 1.2
    for (let i = 0; i < 6; i++) {
      const width = 0.46 + ((i * 3 + row) % 5) * 0.11
      const height = 2.78 + ((row * 2 + i * 7) % 6) * 0.19
      const centerY = shelfLevels[row] + 0.055 + height / 2
      const frontZ = 2.47 - (i % 3) * 0.086
      spines.push(box([x, centerY, frontZ - 0.82], [width, height, 1.64], spineColors[(i + row * 2) % spineColors.length]))
      labels.push(box([x, centerY + height * 0.21, frontZ + 0.011], [width * 0.57, height * 0.10, 0.022]))
      x += width + 0.055
    }
  }
  for (let i = 0; i < 3; i++) {
    const x = cabinet.right - 1.48 - i * 0.97
    spines.push(box([x, baseTop + 2.06, 1.39], [0.91, 4.02, 2.44], '#333333'))
    labels.push(box([x, baseTop + 2.92, 2.621], [0.61, 1.03, 0.024]))
  }
  boxes('books and upright office files', binders, spines, true)
  boxes('book spine labels and stacked pages', paper, [
    ...labels,
    box([cabinet.right - 2.17, shelfLevels[1] + 0.18, 1.55], [2.82, 0.24, 1.73], undefined, -0.08),
    box([cabinet.right - 2.13, shelfLevels[1] + 0.44, 1.57], [2.45, 0.21, 1.55], undefined, 0.045),
    box([10.5, table.top + 0.13, tableZ + 0.32], [3.15, 0.19, 2.08], undefined, 0.14),
  ])
  const globe = shelfGlobe([cabinetX - 1.23, baseTop + 0.055, 1.25])
  shaped('shelf globe', globeMaterial, globe.globe, true)
  shaped('brass meridian and globe stand', brass, globe.mount, true)

  bevels('wide natural oak conference tabletop', oak, [
    box([tableX, table.top - 0.29, tableZ], [tableWidth, 0.58, tableDepth]),
  ], 0.26)
  const legHeight = table.top - 0.44 - floor
  const legs = [table.left + 2.25, table.right - 2.25]
  bevels('conference table legs, cabinet pulls and meeting accessories', metal, [
    ...legs.flatMap((x) => [table.rear + 1.55, table.front - 1.65].map((z) =>
      box([x, floor + legHeight / 2, z], [0.59, legHeight, 0.66]))),
    ...legs.map((x) => box([x, table.top - 0.71, tableZ], [0.51, 0.48, tableDepth - 2.71])),
    box([tableX, table.top - 0.65, tableZ], [27.6, 0.45, 0.65]),
    ...[cabinetX - 0.35, cabinetX + 0.35].map((x) => box([x, baseTop - 1.06, cabinet.front + 0.04], [0.126, 0.89, 0.16])),
    box([-5.1, table.top + 0.13, tableZ + 0.4], [4.62, 0.24, 3.13], undefined, 0.045),
    box([10.5, table.top + 0.035, tableZ + 0.32], [3.28, 0.073, 2.19], undefined, 0.14),
    box([10.5, table.top + 0.264, tableZ + 0.32], [3.28, 0.081, 2.19], undefined, 0.14),
  ], 0.06)
  const chairs = createConferenceChairs(floor)
  shaped('upholstered side chairs and far seat', cloth, chairs.seating, true)
  shaped('splayed chair legs', metal, chairs.supports, true)
  shaped('front upholstered chair backs', cloth, chairs.foreground, true, foreground)
  shaped('front chair legs', metal, chairs.foregroundSupports, true, foreground)

  const treePot: Coordinates = [left + 4.03, floor, 5.14]
  const deskPot: Coordinates = [6.36, table.top, tableZ + 0.05]
  const shelfPot: Coordinates = [cabinet.right - 2.65, shelfLevels[2] + 0.063, 1.49]
  const planter = (radius: number, height: number, position: Coordinates) => pottery([
    [0, 0], [radius * 0.63, 0], [radius * 0.81, height * 0.08], [radius, height * 0.76],
    [radius * 0.995, height], [radius * 0.88, height], [radius * 0.82, height * 0.82], [0, height * 0.8],
  ], position)
  joined('ceramic planters, meeting cup and shelf lamp', ceramic, [
    planter(1.59, 3.53, treePot),
    planter(0.66, 1.07, deskPot),
    planter(0.72, 1.21, shelfPot),
    planter(0.52, 1.04, [-9.8, table.top, tableZ - 0.58]),
    pottery([[0, 0], [0.48, 0], [0.52, 0.07], [0.52, 0.15], [0, 0.15]], [cabinet.left + 1.34, baseTop + 0.055, 1.65]),
  ])
  shaped('shelf lamp diffuser', lightingStrip, new CylinderGeometry(0.39, 0.46, 0.93, 24)
    .translate(cabinet.left + 1.34, baseTop + 0.68, 1.65))
  const treeRoot: Coordinates = [treePot[0], treePot[1] + 3.3, treePot[2]]
  const deskRoot: Coordinates = [deskPot[0], deskPot[1] + 1.01, deskPot[2]]
  const shelfRoot: Coordinates = [shelfPot[0], shelfPot[1] + 1.1, shelfPot[2]]
  const plants = joined('window tree and trailing plants', foliage, [
    addPlantWind(windowPlant(treeRoot), treeRoot, 0.071, 8.2, 0.48),
    addPlantWind(plantLeaves(deskRoot, 0.57), deskRoot, 0.026, 1.85, 2.58),
    addPlantWind(plantLeaves(shelfRoot, 0.99), shelfRoot, 0.033, 3.1, 4.7),
  ])
  plants.customDepthMaterial = foliageDepth

  return {
    room, returns, compactWall, foreground, motionTime,
    setOakTexture(texture: Texture) {
      oak.map = oak.bumpMap = cabinetWood.map = cabinetWood.bumpMap = cabinetInterior.map = flooring.map = texture
    },
    setSkyTexture(texture: Texture) { outside.map = texture },
    dispose() {
      instances.forEach((mesh) => mesh.dispose())
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      spill.dispose()
    },
  }
}
