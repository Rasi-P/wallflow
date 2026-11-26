import { CanvasTexture, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three'

export function createPaperAttachments() {
  const geometry = new PlaneGeometry(0.9, 0.52)
  const materials = [drawAttachment(drawTape), drawAttachment(drawPin)]
  return {
    geometry,
    materials,
    dispose() {
      geometry.dispose()
      for (const material of materials) {
        material.map?.dispose()
        material.dispose()
      }
    },
  }
}

function drawAttachment(paint: (ink: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = 180
  canvas.height = 104
  const ink = canvas.getContext('2d')
  if (!ink) throw new Error('Canvas is unavailable in this browser.')
  paint(ink)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.015, depthWrite: false, toneMapped: false })
}

function drawTape(ink: CanvasRenderingContext2D) {
  const shape = new Path2D('M 17,26 L 158,23 L 154,31 L 161,39 L 157,48 L 162,55 L 158,67 L 163,73 L 18,78 L 21,69 L 15,62 L 20,52 L 15,45 L 21,35 Z')
  ink.save()
  ink.filter = 'blur(4px)'
  ink.translate(2, 5)
  ink.fillStyle = '#49301a56'
  ink.fill(shape)
  ink.restore()
  const ochre = ink.createLinearGradient(0, 26, 0, 78)
  ochre.addColorStop(0, '#eddb9bd9')
  ochre.addColorStop(0.46, '#e7cc88d9')
  ochre.addColorStop(1, '#d8b973cf')
  ink.fillStyle = ochre
  ink.fill(shape)
  ink.save()
  ink.clip(shape)
  for (let i = 0; i < 110; i++) {
    const x = (37 * i) % 171, y = (23 * i) % 62 + 20
    ink.fillStyle = i % 2 ? '#fcf4cf32' : '#aa8d4630'
    ink.fillRect(x, y, 1 + i % 19, 0.7)
  }
  ink.restore()
}

function drawPin(ink: CanvasRenderingContext2D) {
  ink.save()
  ink.filter = 'blur(5px)'
  ink.fillStyle = '#4f321889'
  ink.beginPath()
  ink.ellipse(97, 61, 25, 20, -0.2, 0, 2 * Math.PI)
  ink.fill()
  ink.restore()
  const brass = ink.createRadialGradient(80, 35, 1, 92, 52, 25)
  brass.addColorStop(0, '#faf1c4')
  brass.addColorStop(0.28, '#e6ca7d')
  brass.addColorStop(0.72, '#ab843d')
  brass.addColorStop(0.95, '#79602e')
  brass.addColorStop(1, '#967746')
  ink.fillStyle = brass
  ink.beginPath()
  ink.arc(90, 48, 22, 0, 2 * Math.PI)
  ink.fill()
}
