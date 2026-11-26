import {
  BoxGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  TorusGeometry,
} from 'three'
import type { BufferGeometry, Material, Plane, Texture } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { STUDY_ROOM } from './studyRoomLayout.ts'
import {
  createOakGrain, createOvercastGlass, createStudyFabric, createStudyPlasterBox, STUDY_PLASTER_RELIEF, STUDY_WALL_FACE,
} from './studyRoomMaterials.ts'
import { globeSurface, plantLeaves, pottery } from './studyRoomProps.ts'
import { buildStudyDeskSculpture } from './studyDeskSculpture.ts'
import { addPlantWind, animateFoliage, animateWindowView } from './environmentWind.ts'

type Coordinates = [number, number, number]
type Box = { center: Coordinates; size: Coordinates; turn?: number; tint?: string }

const box = (center: Coordinates, size: Coordinates, turn?: number): Box => ({ center, size, turn })
const skipRaycast = () => {}
const { left: roomLeft, right: roomRight, floor: floorY, ceiling: ceilingY, desk, shelf, window } = STUDY_ROOM
const { left: windowLeft, right: windowRight, bottom: windowBottom, top: windowTop } = window
const desktopY = desk.surface
const windowCenter = (windowLeft + windowRight) / 2
const windowMiddle = (windowBottom + windowTop) / 2
const windowWidth = windowRight - windowLeft
const windowHeight = windowTop - windowBottom

export function buildStudyRoom(planes: Plane[], plasterTexture: Texture) {
  const room = new Group()
  room.name = 'personal-study-room'
  const geometry = new BoxGeometry()
  const geometries: BufferGeometry[] = [geometry]
  const finish = { clippingPlanes: planes, clipIntersection: true }
  const oakGrain = createOakGrain()
  const glassGradient = createOvercastGlass()
  const fabric = createStudyFabric()
  const plaster = new MeshStandardMaterial({ ...finish, map: plasterTexture, bumpMap: plasterTexture, bumpScale: STUDY_PLASTER_RELIEF, roughness: 0.98 })
  const bouncedPlaster = new MeshStandardMaterial({
    ...finish, map: plasterTexture, bumpMap: plasterTexture, bumpScale: STUDY_PLASTER_RELIEF,
    emissive: '#eee3d5', emissiveIntensity: 0.26, roughness: 0.98,
  })
  const trim = new MeshStandardMaterial({ ...finish, color: '#ede9df', roughness: 0.76 })
  const reveal = new MeshStandardMaterial({ ...finish, color: '#d6d1c5', roughness: 0.86 })
  const sash = new MeshStandardMaterial({ ...finish, color: '#a9a9a1', metalness: 0.29, roughness: 0.52 })
  const outside = new MeshBasicMaterial({ ...finish, map: glassGradient, toneMapped: false })
  const motionTime = { value: 0 }
  animateWindowView(outside, motionTime, { canopy: [0.46, 0.71], cloudAmount: 0 })
  const glass = new MeshPhysicalMaterial({ ...finish, color: '#eaf5fb', roughness: 0.15, clearcoat: 0.68,
    transparent: true, depthWrite: false, opacity: 0.13 })
  const oak = new MeshStandardMaterial({ ...finish, map: oakGrain, vertexColors: true, roughness: 0.73 })
  const hardware = new MeshStandardMaterial({ ...finish, color: '#3e403d', roughness: 0.74, metalness: 0.24 })
  const floor = new MeshStandardMaterial({ ...finish, color: '#decab1', map: oakGrain, roughness: 0.83 })
  const seam = new MeshStandardMaterial({ ...finish, color: '#947b60', roughness: 0.93 })
  const linen = new MeshStandardMaterial({ ...finish, vertexColors: true, roughness: 0.92 })
  const bookPaper = new MeshStandardMaterial({ ...finish, color: '#d0c4ad', roughness: 0.95 })
  const ceramic = new MeshStandardMaterial({ ...finish, color: '#ddd7c9', roughness: 0.61 })
  const terracotta = new MeshStandardMaterial({ ...finish, color: '#957357', roughness: 0.77 })
  const soil = new MeshStandardMaterial({ ...finish, color: '#524336', roughness: 1 })
  const foliage = new MeshStandardMaterial({ ...finish, vertexColors: true, side: DoubleSide, roughness: 0.69 })
  const foliageDepth = new MeshDepthMaterial()
  animateFoliage(foliage, motionTime)
  animateFoliage(foliageDepth, motionTime)
  const brass = new MeshStandardMaterial({ ...finish, color: '#92714c', metalness: 0.42, roughness: 0.63 })
  const globe = new MeshStandardMaterial({ ...finish, vertexColors: true, roughness: 0.84 })
  const wool = new MeshStandardMaterial({ ...finish, color: '#bead96', map: fabric, roughness: 1 })
  const materials = [
    plaster, bouncedPlaster, trim, reveal, sash, outside, glass, oak, hardware, floor, seam,
    linen, bookPaper, ceramic, terracotta, soil, foliage, foliageDepth, brass, globe, wool,
  ]
  const placement = new Object3D()

  function batch(name: string, material: Material, pieces: Box[], castShadow = false, receiveShadow = true) {
    const mesh = new InstancedMesh(geometry, material, pieces.length)
    mesh.name = name
    mesh.receiveShadow = receiveShadow
    mesh.castShadow = castShadow
    mesh.raycast = skipRaycast
    const instanceColor = new Color()
    pieces.forEach(({ center, size, turn, tint }, index) => {
      placement.position.set(...center)
      placement.scale.set(...size)
      placement.rotation.y = turn ?? 0
      placement.updateMatrix()
      mesh.setMatrixAt(index, placement.matrix)
      if (tint) mesh.setColorAt(index, instanceColor.set(tint))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    room.add(mesh)
    return mesh
  }

  function join(name: string, material: Material, parts: BufferGeometry[], castShadow = false) {
    const combined = mergeGeometries(parts)!
    parts.forEach((part) => part.dispose())
    geometries.push(combined)
    const mesh = new Mesh(combined, material)
    mesh.name = name
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    mesh.raycast = skipRaycast
    room.add(mesh)
    return mesh
  }

  function beveled(pieces: Box[], radius: number, wood = false) {
    const tints = ['#ffffff', '#eceae5', '#f7f5f1', '#eae9e6']
    return pieces.map(({ center, size, turn, tint: finishTint }, index) => {
      const part = new RoundedBoxGeometry(...size, 1, radius)
      if (wood || finishTint) {
        const tint = new Color(finishTint ?? tints[index % tints.length])
        const colors = new Float32Array(part.attributes.position.count * 3)
        const uv = part.attributes.uv
        const upright = size[1] > Math.max(size[0], size[2])
        const grainWidth = index === 0 ? 1 : 0.82
        const grainHeight = index === 0 ? 1 : 0.78
        const grainX = index % 3 * 0.075
        const grainY = index % 4 * 0.065
        for (let i = 0; i < uv.count; i++) {
          if (wood) {
            const u = upright ? uv.getY(i) : uv.getX(i)
            const v = upright ? 1 - uv.getX(i) : uv.getY(i)
            uv.setXY(i, u * grainWidth + grainX, v * grainHeight + grainY)
          }
          tint.toArray(colors, i * 3)
        }
        part.setAttribute('color', new Float32BufferAttribute(colors, 3))
      }
      if (turn) part.rotateY(turn)
      return part.translate(...center)
    })
  }

  function wallPanel(left: number, right: number, bottom: number, top: number) {
    const depth = 2.06
    return box([(left + right) / 2, (bottom + top) / 2, STUDY_WALL_FACE - depth / 2], [right - left, top - bottom, depth])
  }
  const roomWidth = roomRight - roomLeft
  const roomCenter = (roomRight + roomLeft) / 2
  const plasterPanel = ({ size, center }: Box) => createStudyPlasterBox(...size, ...center).translate(...center)
  join('main plaster wall', plaster, [
    wallPanel(roomLeft, windowLeft, floorY, ceilingY),
    wallPanel(windowRight, roomRight, floorY, ceilingY),
    wallPanel(windowLeft, windowRight, floorY, windowBottom),
    wallPanel(windowLeft, windowRight, windowTop, ceilingY),
  ].map(plasterPanel))
  const roomReturns = join('plaster side returns and ceiling', bouncedPlaster, [
    ...[roomLeft - 0.27, roomRight + 0.27].map((x) =>
      box([x, (ceilingY + floorY) / 2, 13.8], [0.54, ceilingY - floorY, 31.8])),
    box([roomCenter, ceilingY + 0.23, 13.8], [roomWidth, 0.46, 31.8]),
  ].map(plasterPanel))
  const compactWall = join('plaster above the portrait workspace', plaster, [
    wallPanel(roomLeft, roomRight, ceilingY, 125),
  ].map(plasterPanel))
  compactWall.visible = false

  join('recessed window jambs', reveal, beveled([
    ...[windowLeft, windowRight].map((x) => box([x, windowMiddle, -0.86], [0.31, windowHeight, 1.44])),
    ...[windowBottom, windowTop].map((y) => box([windowCenter, y, -0.86], [windowWidth, 0.31, 1.44])),
  ], 0.036))
  join('inset sash and window mullions', sash, beveled([
    ...[windowLeft + 0.23, windowCenter, windowRight - 0.23]
      .map((x) => box([x, windowMiddle, -1.23], [x === windowCenter ? 0.29 : 0.36, windowHeight, 0.34])),
    ...[windowBottom + 0.23, windowMiddle - 0.65, windowTop - 0.23]
      .map((y) => box([windowCenter, y, -1.22], [windowWidth, 0.31, 0.38])),
  ], 0.026), true)
  join('window casing, sill and baseboards', trim, beveled([
    ...[windowLeft - 0.03, windowRight + 0.03]
      .map((x) => box([x, windowMiddle, -0.2], [0.52, windowHeight + 0.61, 0.28])),
    box([windowCenter, windowTop + 0.14, -0.2], [windowWidth + 0.75, 0.49, 0.29]),
    box([windowCenter, windowBottom - 0.1, -0.47], [windowWidth + 0.76, 0.36, 1.65]),
    box([roomCenter, floorY + 0.37, -0.155], [roomWidth, 0.74, 0.21]),
    ...[roomLeft + 0.1, roomRight - 0.1].map((x) => box([x, floorY + 0.37, 13.5], [0.2, 0.74, 27.6])),
  ], 0.04))
  const glazing = join('recessed glass pane', glass,
    [new PlaneGeometry(windowWidth - 0.28, windowHeight - 0.28).translate(windowCenter, windowMiddle, -1.42)])
  glazing.renderOrder = 1
  join('distant trees through the window', outside,
    [new PlaneGeometry(windowWidth + 10, windowHeight + 9).translate(windowCenter - 1.5, windowMiddle + 0.6, -4.95)])

  batch('floor under the oak planks', seam, [box([roomCenter, floorY - 0.23, 25.35], [roomWidth, 0.4, 53.4])])
  const planks: Box[] = []
  const floorTints = ['#f4ede3', '#eee4d7', '#e5d9c8', '#f8f4eb', '#e8ded1']
  for (let row = 0; row < 44; row++) {
    let start: number = roomLeft
    for (let col = 0; start < roomRight - 0.04; col++) {
      const end = Math.min(roomRight, start + 7.1 + (row * 11 + col * 5) % 10)
      const plank = box([(start + end) / 2, floorY - 0.025, -0.22 + row * 1.19],
        [end - start - 0.029, 0.05, 1.166])
      plank.tint = floorTints[(row * 3 + col * 2) % floorTints.length]
      planks.push(plank)
      start = end
    }
  }
  batch('staggered oak floorboards', floor, planks)
  join('woven rug', wool, beveled([box([0.8, floorY + 0.018, 20], [40.8, 0.108, 17])], 0.045))

  const deskX = (desk.left + desk.right) / 2
  const deskWidth = desk.right - desk.left
  const deskZ = (desk.front + desk.rear) / 2
  const shelfX = (shelf.left + shelf.right) / 2
  const shelfWidth = shelf.right - shelf.left
  const shelfDepth = shelf.front - shelf.rear
  const shelfZ = (shelf.front + shelf.rear) / 2
  const shelfLevels = [floorY + 0.38, -13.7, -8.07, -2.12]
  join('oak desk and bookcase', oak, beveled([
    box([deskX, desktopY - 0.29, deskZ], [deskWidth, 0.58, desk.front - desk.rear]),
    { ...box([deskX, desktopY - 0.69, desk.front - 0.48], [deskWidth - 1.17, 0.38, 0.29]), tint: '#bdac9a' },
    ...[shelf.left + 0.19, shelf.right - 0.19].map((x) =>
      box([x, (floorY + shelf.top) / 2, shelfZ], [0.38, shelf.top - floorY, shelfDepth])),
    ...[...shelfLevels, shelf.top - 0.19].map((y) =>
      box([shelfX, y, shelfZ], [shelfWidth - 0.48, 0.38, shelfDepth - 0.15])),
    { ...box([shelfX, (floorY + shelf.top) / 2, shelf.rear + 0.09], [shelfWidth - 0.37, shelf.top - floorY, 0.16]), tint: '#ab9d8b' },
  ], 0.095, true), true)
  const legHeight = desktopY - 0.54 - floorY
  join('desk supports', hardware, beveled([desk.left + 1.7, desk.right - 1.7].flatMap((x) => [
    box([x, floorY + legHeight / 2, desk.front - 0.62], [0.43, legHeight, 0.46]),
    box([x, floorY + legHeight / 2, desk.rear + 0.67], [0.4, legHeight, 0.43]),
    box([x, floorY + legHeight - 0.12, deskZ], [0.4, 0.32, desk.front - desk.rear - 0.65]),
  ]), 0.037), true)

  const bookRows = [
    { offset: 0.62, heights: [2.75, 3.13, 2.58, 3.44, 3.19] },
    { offset: 0.87, heights: [3.52, 3.15, 3.46, 3.67, 3.23, 2.87] },
    { offset: 0.7, heights: [3.24, 3.62, 2.93, 3.27] },
    { offset: 0.91, heights: [3.28, 3.71, 4.19, 3.91, 4.28, 3.54] },
  ]
  const covers: Box[] = []
  const pages: Box[] = []
  const jackets = ['#777b70', '#9b8970', '#566167', '#b2a18b', '#6e6f5d', '#626262']
  for (const [row, { offset, heights }] of bookRows.entries()) {
    let start = shelf.left + offset
    const y = shelfLevels[row] + 0.19
    for (const [index, height] of heights.entries()) {
      const width = [0.49, 0.75, 0.57, 0.63][(index + row) % 4]
      const center = start + width / 2
      const front = shelf.front - 0.44 - index % 3 * 0.11
      const depth = 1.34 + (row + index) % 3 * 0.18
      const cover = box([center, y + height / 2, front - depth / 2], [width, height, depth])
      cover.tint = jackets[(index * 5 + row * 3) % jackets.length]
      covers.push(cover)
      pages.push(box([center, y + height - 0.015, front - depth * 0.58], [width - 0.105, 0.04, depth - 0.32]))
      if (index % 2 === 0) pages.push(box([center, y + height - 0.48, front + 0.006], [width - 0.19, 0.065, 0.017]))
      start += width + 0.067
    }
  }
  covers.push(
    { ...box([-12.4, desktopY + 0.10, 2], [2.98, 0.2, 1.86], -0.12), tint: '#9a7959' },
    { ...box([-12.52, desktopY + 0.29, 1.99], [2.68, 0.18, 1.76], 0.07), tint: '#655f51' },
  )
  pages.push(
    box([-12.4, desktopY + 0.10, 2.012], [2.81, 0.12, 1.86], -0.12),
    box([-12.52, desktopY + 0.29, 2.001], [2.5, 0.11, 1.76], 0.07),
  )
  join('cloth, leather and paper book covers', linen, beveled(covers, 0.038))
  batch('book page blocks and spine bands', bookPaper, pages)

  const sillPlant: Coordinates = [windowLeft + 1.52, windowBottom + 0.055, -0.41]
  const shelfPlant: Coordinates = [shelf.right - 2.1, shelf.top, 1.71]
  const planter = (position: Coordinates) => pottery([
    [0, 0], [0.52, 0], [0.58, 0.10], [0.69, 0.89], [0.73, 0.93], [0.73, 1.06],
    [0.65, 1.06], [0.64, 0.91], [0.52, 0.15], [0, 0.15],
  ], position)
  join('planters', terracotta, [planter(sillPlant), planter(shelfPlant)], true)
  join('potting soil', soil, [sillPlant, shelfPlant].map(([x, y, z]) =>
    new CylinderGeometry(0.633, 0.63, 0.065, 20).translate(x, y + 0.96, z)))
  const sillRoot: Coordinates = [sillPlant[0], sillPlant[1] + 0.95, sillPlant[2]]
  const shelfRoot: Coordinates = [shelfPlant[0], shelfPlant[1] + 0.95, shelfPlant[2]]
  const plants = join('pothos on the sill and bookshelf', foliage, [
    addPlantWind(plantLeaves(sillRoot, 1.02), sillRoot, 0.058, 3.1, 0.74),
    addPlantWind(plantLeaves(shelfRoot, 1.16), shelfRoot, 0.035, 3.5, 3.9),
  ], true)
  plants.customDepthMaterial = foliageDepth

  const cupX = -7.9
  join('stoneware pencil cup and small shelf bowl', ceramic, [
    pottery([[0, 0], [0.57, 0], [0.58, 0.76], [0.52, 0.76], [0.49, 0.08], [0, 0.08]], [cupX, desktopY, 2.33]),
    pottery([[0, 0], [0.34, 0], [0.48, 0.17], [0.55, 0.32], [0.50, 0.32], [0.37, 0.13], [0, 0.12]],
      [shelf.right - 1.36, shelfLevels[1] + 0.19, shelf.front - 1.05]),
  ], true)
  join('pencils', hardware, [-0.23, -0.07, 0.08, 0.23].map((x, index) =>
    new CylinderGeometry(0.048, 0.052, 0.88 + index % 2 * 0.21, 7)
      .rotateZ(-x * 1.45).rotateX(index % 2 * 0.23).translate(cupX + x, desktopY + 0.73 + index % 2 * 0.07, 2.27 + index % 2 * 0.24)))

  const globeX = shelf.right - 1.65
  const globeY = shelfLevels[2] + 1.48
  const globeZ = shelf.front - 1.24
  join('shelf globe', globe, [globeSurface([globeX, globeY, globeZ])])
  join('globe stand and meridian', brass, [
    pottery([[0, 0], [0.76, 0], [0.68, 0.115], [0.31, 0.14], [0.18, 0.42], [0, 0.42]],
      [globeX, shelfLevels[2] + 0.19, globeZ]),
    new TorusGeometry(0.96, 0.036, 7, 32).rotateY(0.2).rotateZ(-0.35).translate(globeX, globeY, globeZ),
  ])

  const deskSculpture = buildStudyDeskSculpture(planes)
  room.add(deskSculpture.sculpture)

  return {
    room,
    plaster,
    bouncedPlaster,
    outside,
    glassGradient,
    roomReturns,
    compactWall,
    updateMotion(seconds: number) {
      motionTime.value = seconds
      deskSculpture.update(seconds)
    },
    dispose() {
      room.children.forEach((child) => { if (child instanceof InstancedMesh) child.dispose() })
      geometries.forEach((part) => part.dispose())
      materials.forEach((material) => material.dispose())
      deskSculpture.dispose()
      oakGrain.dispose()
      glassGradient.dispose()
      fabric.dispose()
    },
  }
}

