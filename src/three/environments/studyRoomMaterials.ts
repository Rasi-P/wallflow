import { BoxGeometry, CanvasTexture, SRGBColorSpace } from 'three'

export const STUDY_BOARD_THICKNESS = 0.22
export const STUDY_WALL_FACE = -0.255
export const STUDY_PLASTER_RELIEF = 0.018

function surfaceTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The study room requires Canvas 2D for material textures.')
  paint(context)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function valueNoise(cells: number, next: () => number) {
  const stride = cells + 1
  const values = Float32Array.from({ length: stride * stride }, next)
  const ease = (t: number) => t * t * (3 - 2 * t)
  return (u: number, v: number) => {
    const x = u * cells, y = v * cells
    const col = Math.floor(x), row = Math.floor(y)
    const s = ease(x - col), t = ease(y - row)
    const a = row * stride + col
    const b = a + stride
    const top = values[a] + (values[a + 1] - values[a]) * s
    const bottom = values[b] + (values[b + 1] - values[b]) * s
    return top + (bottom - top) * t
  }
}

export function createStudyPlaster() {
  return surfaceTexture(512, 512, (ctx) => {
    let seed = 971
    const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const broad = valueNoise(9, next)
    const middle = valueNoise(37, next)
    const fine = valueNoise(127, next)
    const image = ctx.createImageData(512, 512)
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const u = x / image.width, v = y / image.height
        const i = (y * image.width + x) * 4
        const tone = 249 + 5 * (broad(u, v) - 0.5) + 6 * (middle(u, v) - 0.5) + 9 * (fine(u, v) - 0.5)
        image.data[i] = image.data[i + 1] = image.data[i + 2] = tone
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

// One non-tiled finish spans the wall. The two front surfaces match when the board is straight.
export function createStudyPlasterBox(width: number, height: number, depth: number, x = 0, y = 0, z = 0) {
  const geometry = new BoxGeometry(width, height, depth)
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const uv = geometry.attributes.uv
  for (let i = 0; i < position.count; i++) {
    const across = normal.getX(i) === 0 ? position.getX(i) + x : position.getZ(i) + z
    const up = normal.getY(i) === 0 ? position.getY(i) + y : position.getZ(i) + z
    uv.setXY(i, (across + 32) / 68, (up + 24) / 44)
  }
  return geometry
}

export function createOakGrain() {
  return surfaceTexture(512, 256, (ctx) => {
    const image = ctx.createImageData(512, 256)
    let seed = 259
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const u = x / image.width
        const v = y / image.height
        const knotX = (u - 0.69) * 5, knotY = (v - 0.42) * 9
        const knot = Math.exp(-(knotX ** 2 + knotY ** 2))
        const second = Math.exp(-(((u - 0.21) * 6) ** 2 + ((v - 0.68) * 11) ** 2))
        const grain = v + 0.027 * Math.sin(u * 9 + v * 16) + 0.021 * knot * knotY + 0.13 * (v - 0.68) * second
        const growth = Math.sin(grain * 131 + Math.sin(grain * 31 + u * 5) * 2.9)
        const fibers = Math.sin(grain * 683 + Math.sin(u * 14) * 2.2)
        const figure = Math.sin(grain * 39 + u * 3) + Math.sin(grain * 18 - u * 7)
        seed = (seed * 16807) % 2147483647
        const tone = growth * 8 + fibers * 4 + figure * 6 - knot * 8 - second * 4 + (seed / 2147483647 - 0.5) * 5
        const i = (y * image.width + x) * 4
        image.data[i] = 190 + tone
        image.data[i + 1] = 158 + tone * 1.13
        image.data[i + 2] = 129 + tone * 1.21
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

export function createOvercastGlass() {
  return surfaceTexture(64, 128, (ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 128)
    sky.addColorStop(0, '#cbd9e1')
    sky.addColorStop(0.65, '#e1e9eb')
    sky.addColorStop(1, '#eaece8')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 64, 128)
    const reflection = ctx.createLinearGradient(0, 36, 56, 50)
    reflection.addColorStop(0, 'rgba(255,255,255,0.23)')
    reflection.addColorStop(0.42, 'rgba(255,255,255,0.05)')
    reflection.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = reflection
    ctx.fillRect(0, 0, 64, 128)
  })
}

export function createWindowLightMask() {
  return surfaceTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 128, 128)
    // White transmits daylight. The center mullion and the meeting rail soften the light.
    ctx.filter = 'blur(2px)'
    ctx.fillStyle = '#fff'
    for (const x of [24, 66]) {
      ctx.fillRect(x, 18, 37, 41)
      ctx.fillRect(x, 65, 37, 45)
    }
  })
}

export function createStudyFabric() {
  return surfaceTexture(128, 128, (ctx) => {
    const data = ctx.createImageData(128, 128)
    let seed = 19
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        seed = (seed * 16807) % 2147483647
        const fiber = Math.sin(x * Math.PI * 0.5) * Math.cos(y * Math.PI * 0.5)
        const value = 219 + 15 * fiber + 13 * (seed / 2147483647 - 0.5)
        const i = (y * 128 + x) * 4
        data.data[i] = data.data[i + 1] = data.data[i + 2] = value
        data.data[i + 3] = 255
      }
    }
    ctx.putImageData(data, 0, 0)
  })
}
