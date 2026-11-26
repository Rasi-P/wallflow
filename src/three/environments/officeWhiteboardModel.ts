import {
  BoxGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, LinearFilter,
  Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
} from 'three'
import type { BufferGeometry, Material, Plane, Texture } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { OFFICE_DOWNLIGHT, OFFICE_ROOM } from './officeWhiteboardLayout.ts'
import { officeCeiling, officeDownlightHousing, officeFootContacts, officeOcclusionGeometry, officeOcclusionTexture } from './officeWhiteboardLightingGeometry.ts'
import { conferenceTableFrame, conferenceTabletop, createConferenceChairs, createOfficePlant, shelfGlobe } from './officeWhiteboardFurnishings.ts'
import { officeBooks } from './officeWhiteboardBooks.ts'
import { pottery } from './studyRoomProps.ts'
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

const box = (center: Coordinates, size: Coordinates, tint?: string, turn?: number): Box => ({ center, size, tint, turn })

function shelfLightSpill() {
  const height = 32
  const data = new Uint8Array(height * 4)
  for (let row = 0; row < height; row++) {
    const intensity = Math.round(255 * (row / (height - 1)) ** 5)
    data.set([intensity, intensity, intensity, 255], row * 4)
  }
  const texture = new DataTexture(data, 1, height)
  texture.channel = 1
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
  const rightWall = new MeshStandardMaterial({ ...finish, color: '#e4dad0', roughness: 0.91 })
  const ceilingPaint = new MeshStandardMaterial({
    ...finish, color: '#efede8', vertexColors: true, roughness: 1, bumpMap: textures.plaster, bumpScale: 0.011,
    emissive: '#ece9e3', emissiveIntensity: 0.065,
  })
  const downlightTrim = new MeshStandardMaterial({
    ...finish, vertexColors: true, side: DoubleSide, roughness: 0.83, emissive: '#d4b493', emissiveIntensity: 0.065,
  })
  const contactTexture = officeOcclusionTexture()
  const contact = new MeshBasicMaterial({
    ...finish, color: '#342e29', map: contactTexture, vertexColors: true, opacity: 0.30, transparent: true,
    depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
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
    ...finish, color: '#f6f2eb', map: textures.oak, bumpMap: textures.oak, bumpScale: 0.017,
    roughness: 0.48, clearcoat: 0.19, clearcoatRoughness: 0.42,
  })
  const cabinetWood = new MeshStandardMaterial({
    ...finish, color: '#aaa298', map: textures.oak, bumpMap: textures.oak, bumpScale: 0.018, roughness: 0.64,
  })
  const spill = shelfLightSpill()
  const cabinetInterior = new MeshStandardMaterial({
    ...finish, color: '#a19b8e', map: textures.oak, roughness: 0.77,
    emissive: '#ffe0ac', emissiveMap: spill, emissiveIntensity: 0.39,
  })
  const lacquer = new MeshStandardMaterial({ ...finish, color: '#cec3b7', roughness: 0.59 })
  const lightingStrip = new MeshBasicMaterial({ ...finish, color: '#ffe4c0', toneMapped: false })
  const metal = new MeshStandardMaterial({ ...finish, color: '#303334', roughness: 0.47, metalness: 0.33 })
  const binders = new MeshStandardMaterial({ ...finish, vertexColors: true, roughness: 0.85 })
  const paper = new MeshStandardMaterial({ ...finish, color: '#cbc1ac', roughness: 0.96 })
  const soil = new MeshStandardMaterial({ ...finish, color: '#504334', bumpMap: textures.plaster, bumpScale: 0.023, roughness: 1 })
  const ceramic = new MeshStandardMaterial({
    ...finish, color: '#eee4d6', bumpMap: textures.plaster, bumpScale: 0.045, roughness: 0.63,
  })
  const foliage = new MeshStandardMaterial({ ...finish, vertexColors: true, side: DoubleSide, roughness: 0.66 })
  const foliageDepth = new MeshDepthMaterial()
  animateFoliage(foliage, motionTime)
  animateFoliage(foliageDepth, motionTime)
  const cloth = new MeshPhysicalMaterial({
    ...finish, vertexColors: true, map: textures.fabric, bumpMap: textures.fabric, bumpScale: 0.022, roughness: 0.89,
    sheen: 0.31, sheenColor: '#ded4c8', sheenRoughness: 0.78,
  })
  const globeMaterial = new MeshStandardMaterial({ ...finish, vertexColors: true, roughness: 0.6 })
  const brass = new MeshStandardMaterial({ ...finish, color: '#a68b56', metalness: 0.52, roughness: 0.37 })
  const materials = [plaster, rightWall, ceilingPaint, downlightTrim, contact, flooring, floorBase, trim, glass, outside,
    oak, cabinetWood, cabinetInterior, lacquer, lightingStrip, metal, binders, paper, ceramic, soil, foliage,
    foliageDepth, cloth, globeMaterial, brass]
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
  const soffitBlank = new BoxGeometry(roomWidth, 0.43, 2.05)
  const soffit = soffitBlank.toNonIndexed().translate(roomX, ceiling - 0.21, 0.53)
  soffitBlank.dispose()
  soffit.setAttribute('color', new Float32BufferAttribute(new Float32Array(soffit.attributes.position.count * 3).fill(0.96), 3))
  joined('matte ceiling and soffit', ceilingPaint, [officeCeiling(-0.52, roomDepth), soffit], false, returns)
  joined('recessed warm downlight housings', downlightTrim, OFFICE_DOWNLIGHT.locations.map(officeDownlightHousing), false, returns)
  boxes('right plaster return', rightWall, [
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
  const shelfTops = [baseTop, -1.91, 5.73] as const
  const stile = 0.44
  const shelfThickness = 0.32
  const crownThickness = 0.4
  const shelfLids = [shelfTops[1] - shelfThickness, shelfTops[2] - shelfThickness, cabinet.top - crownThickness]
  const interiorWidth = cabinetWidth - 2 * stile
  const shelfRear = -0.19
  const shelfFront = cabinet.front - 0.19
  const shelfDepth = shelfFront - shelfRear
  const shelfCenter = (shelfRear + shelfFront) / 2
  bevels('built-in oak uprights and open shelves', cabinetWood, [
    ...[cabinet.left + stile / 2, cabinet.right - stile / 2].map((x) =>
      box([x, floor + cabinetHeight / 2, (wallFace + cabinet.front) / 2], [stile, cabinetHeight, cabinet.front - wallFace])),
    box([cabinetX, cabinet.top - crownThickness / 2, shelfCenter], [interiorWidth, crownThickness, shelfDepth]),
    ...shelfTops.map((y) => box([cabinetX, y - shelfThickness / 2, shelfCenter], [interiorWidth, shelfThickness, shelfDepth])),
  ], 0.052, true)
  const doorGap = 0.095
  const doorWidth = (interiorWidth - doorGap - 0.2) / 2
  const doorBottom = floor + 0.49
  const doorTop = baseTop - shelfThickness - 0.10
  bevels('lower cabinet doors', lacquer, [
    ...[-1, 1].map((side) => box([cabinetX + side * (doorWidth + doorGap) / 2,
      (doorBottom + doorTop) / 2, cabinet.front - 0.16], [doorWidth, doorTop - doorBottom, 0.25])),
    box([cabinetX, floor + 0.22, cabinet.front - 0.44], [interiorWidth - 0.25, 0.44, 0.20]),
  ], 0.033)
  joined('oak cabinet backs with local light spill', cabinetInterior, shelfTops.map((bottom, i) => {
    const top = shelfLids[i]
    const geometry = new BoxGeometry(interiorWidth, top - bottom, 0.2)
    const { uv } = geometry.attributes
    geometry.setAttribute('uv1', uv.clone())
    for (let v = 0; v < uv.count; v++) uv.setXY(v, uv.getY(v), 1 - uv.getX(v))
    return geometry.translate(cabinetX, (bottom + top) / 2, shelfRear - 0.10)
  }), false)
  boxes('warm under-shelf strip lights', lightingStrip, shelfLids.map((y) =>
    box([cabinetX, y - 0.026, shelfFront - 0.76], [interiorWidth - 0.67, 0.034, 0.10])))

  const { shelves, notebook } = officeBooks(shelfTops)
  const books = [...shelves.flat(), notebook]
  joined('cloth book covers and rounded spines', binders, books.map(({ jacket }) => jacket))
  joined('inset pages and spine stamps', paper, books.flatMap(({ pages, stamp }) => [pages, stamp]), false)
  const globe = shelfGlobe([cabinetX - 1.63, baseTop, 1.22])
  shaped('shelf globe', globeMaterial, globe.globe, true)
  shaped('brass meridian and globe stand', brass, globe.mount, true)

  shaped('wide natural oak conference tabletop', oak, conferenceTabletop(), true)
  const tableFrame = conferenceTableFrame()
  const tableContacts = officeFootContacts(tableFrame)
  joined('conference table frame and cabinet pulls', metal, [
    tableFrame,
    ...[cabinetX - 0.36, cabinetX + 0.36].map((x) =>
      new RoundedBoxGeometry(0.12, 0.94, 0.16, 1, 0.046).translate(x, doorTop - 0.68, cabinet.front + 0.035)),
  ])
  const chairs = createConferenceChairs(floor)
  const side = chairs.filter((chair) => !chair.foreground)
  const near = chairs.filter((chair) => chair.foreground)
  const sideContacts = side.flatMap(({ frame }) => officeFootContacts(frame))
  const foregroundContacts = near.flatMap(({ frame }) => officeFootContacts(frame))
  joined('upholstered side chairs', cloth, side.map(({ upholstery }) => upholstery))
  joined('side chair frames', metal, side.map(({ frame }) => frame))
  joined('front upholstered chair backs', cloth, near.map(({ upholstery }) => upholstery), true, foreground)
  joined('front chair frames', metal, near.map(({ frame }) => frame), true, foreground)

  shaped('floor and cabinet contact shadows', contact, officeOcclusionGeometry([
    ...tableContacts,
    ...sideContacts,
    { x: roomX, y: floor + 0.009, z: 0.11, width: roomWidth, height: 1.62, strength: 0.43, surface: 'floor' },
    { x: cabinetX, y: floor + 0.009, z: cabinet.front - 0.05, width: cabinetWidth + 2.05, height: 1.92,
      strength: 0.68, surface: 'floor' },
    ...[cabinet.left, cabinet.right].map((x) => ({
      x, y: floor + cabinetHeight / 2, z: wallFace + 0.009, width: 1.81, height: cabinetHeight,
      strength: 0.38, surface: 'wall' as const,
    })),
  ]))
  shaped('foreground chair contact shadows', contact, officeOcclusionGeometry(foregroundContacts), false, foreground)

  const plantsOnSurfaces = [
    { kind: 'floor', position: [left + 3.56, floor, 5.6], radius: 1.31, height: 2.74, wind: [0.071, 8.2, 0.48] },
    { kind: 'desk', position: [8.13, table.top, table.front - 1.68], radius: 0.61, height: 0.61, wind: [0.026, 1.85, 2.58] },
    { kind: 'shelf', position: [cabinet.right - 2.6, shelfTops[2], 1.35], radius: 0.70, height: 0.91, wind: [0.033, 3.1, 4.7] },
  ] satisfies { kind: 'floor' | 'desk' | 'shelf'; position: Coordinates; radius: number; height: number; wind: Coordinates }[]
  const planter = (radius: number, height: number, position: Coordinates) => pottery([
    [0, 0], [radius * 0.69, 0], [radius * 0.79, height * 0.055], [radius, height * 0.82],
    [radius * 0.993, height], [radius * 0.875, height], [radius * 0.83, height * 0.83], [0, height * 0.8],
  ], position)
  joined('ceramic planters and stoneware cup', ceramic, [
    ...plantsOnSurfaces.map(({ radius, height, position }) => planter(radius, height, position)),
    pottery([[0, 0], [0.38, 0], [0.42, 0.053], [0.45, 0.83], [0.43, 0.86], [0.40, 0.85], [0.365, 0.1], [0, 0.1]],
      [-8.6, table.top, 16.15]),
  ])
  joined('soil inside the office planters', soil, plantsOnSurfaces.map(({ position: [x, y, z], radius, height }) =>
    new CylinderGeometry(radius * 0.835, radius * 0.825, 0.028, 20).translate(x, y + height * 0.86, z)), false)
  const plants = joined('individual leaves and branching stems', foliage,
    plantsOnSurfaces.map(({ kind, position: [x, y, z], height, wind }) => {
      const root: Coordinates = [x, y + height * 0.86 + 0.01, z]
      return addPlantWind(createOfficePlant(kind, root), root, ...wind)
    }))
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
      contactTexture.dispose()
    },
  }
}
