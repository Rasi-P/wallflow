import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import type { StickyNoteData } from '../types/wall.ts'
import { NOTE_COLORS } from '../utils/constants.ts'
import type { TaskInk } from '../utils/noteTasks.ts'
import { NOTE_BODY_FONT, NOTE_TITLE_FONTS } from '../utils/appearance.ts'

function canvas(size: number) {
  const element = document.createElement('canvas')
  element.width = size
  element.height = size
  const context = element.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  return { element, context }
}

// Seeded grain stays stable between renders and does not require remote assets.
function random(seed: number) {
  let value = seed
  return () => { value = (value * 16807) % 2147483647; return value / 2147483647 }
}

export function createPlasterTexture() {
  const size = 512
  const cells = 16
  const cellSize = size / cells
  const { element, context } = canvas(size)
  const image = context.createImageData(size, size)
  const noise = random(42)
  const plaster = Array.from({ length: cells * cells }, noise)
  const ease = (fraction: number) => fraction * fraction * (3 - 2 * fraction)
  const mix = (a: number, b: number, amount: number) => a + (b - a) * amount
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / cellSize)
    const nextRow = (row + 1) % cells
    const vertical = ease((y % cellSize) / cellSize)
    for (let x = 0; x < size; x++) {
      const col = Math.floor(x / cellSize)
      const right = (col + 1) % cells
      const across = ease((x % cellSize) / cellSize)
      const top = mix(plaster[row * cells + col], plaster[row * cells + right], across)
      const bottom = mix(plaster[nextRow * cells + col], plaster[nextRow * cells + right], across)
      const value = 151 + 43 * mix(top, bottom, vertical) + 18 * noise()
      const index = (y * size + x) * 4
      image.data[index] = image.data[index + 1] = image.data[index + 2] = value
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const texture = new CanvasTexture(element)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(6, 4)
  return texture
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (context.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word }
      else line = candidate
      // Split long unbroken words so user text stays on the paper.
      while (context.measureText(line).width > maxWidth) {
        const characters = Array.from(line)
        if (characters.length <= 1) break
        let end = characters.length - 1
        while (end > 1 && context.measureText(characters.slice(0, end).join('')).width > maxWidth) end--
        lines.push(characters.slice(0, end).join(''))
        line = characters.slice(end).join('')
      }
    }
    lines.push(line)
  }
  return lines
}

function ellipsize(context: CanvasRenderingContext2D, line: string, width: number) {
  const characters = Array.from(line.trimEnd())
  while (characters.length && context.measureText(`${characters.join('')}…`).width > width) characters.pop()
  return `${characters.join('')}…`
}

export const NOTE_TEXTURE_SIZE = 1024
export const DEFAULT_NOTE_TITLE = 'A fresh little thought.'
export const DEFAULT_NOTE_BODY = 'Double-click to make it yours.'
export type NoteInk = Pick<StickyNoteData, 'title' | 'body' | 'doodle' | 'typography'> & { task?: TaskInk }
export type NoteArtwork = NoteInk & Pick<StickyNoteData, 'color'>
let paperFinish: HTMLCanvasElement | undefined

export function getPaperFinish() {
  if (paperFinish) return paperFinish
  const { element, context: ctx } = canvas(NOTE_TEXTURE_SIZE)
  const grain = random(19)
  for (let i = 0; i < 55000; i++) {
    ctx.fillStyle = grain() > 0.5 ? 'rgba(255,255,252,0.075)' : 'rgba(72,69,60,0.041)'
    ctx.fillRect(grain() * NOTE_TEXTURE_SIZE, grain() * NOTE_TEXTURE_SIZE, i % 8 === 0 ? 1 + grain() * 3.8 : 0.6 + grain() * 1.4, 0.65 + grain() * 1.15)
  }
  const adhesive = ctx.createLinearGradient(0, 0, 0, 190)
  adhesive.addColorStop(0, 'rgba(65,63,55,0.05)')
  adhesive.addColorStop(0.55, 'rgba(65,63,55,0.018)')
  adhesive.addColorStop(1, 'rgba(65,63,55,0)')
  ctx.fillStyle = adhesive
  ctx.fillRect(0, 0, NOTE_TEXTURE_SIZE, 190)
  paperFinish = element
  return element
}

function paintNote(ctx: CanvasRenderingContext2D, note: NoteArtwork) {
  const { paper, ink } = NOTE_COLORS[note.color]
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, NOTE_TEXTURE_SIZE, NOTE_TEXTURE_SIZE)
  ctx.drawImage(getPaperFinish(), 0, 0)
  paintNoteInk(ctx, note, ink)
}

export function paintNoteInk(ctx: CanvasRenderingContext2D, note: NoteInk, ink: string) {
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const titleFont = NOTE_TITLE_FONTS[note.typography ?? 'handwritten']
  const title = note.title || DEFAULT_NOTE_TITLE
  const width = 800
  ctx.font = `700 82px ${titleFont}`
  let titleLines = wrap(ctx, title, width)
  if (titleLines.length > 2) { ctx.font = `700 70px ${titleFont}`; titleLines = wrap(ctx, title, width) }
  let y = 182
  for (const [index, line] of titleLines.slice(0, 3).entries()) {
    ctx.fillText(index === 2 && titleLines.length > 3 ? ellipsize(ctx, line, width) : line, 108, y, width)
    y += 98
  }
  y += 38
  const body = note.body || (note.task ? '' : DEFAULT_NOTE_BODY)
  ctx.font = `450 56px ${NOTE_BODY_FONT}`
  let bodyLines = wrap(ctx, body, width)
  let lineHeight = 79
  const bodyLimit = note.task?.rows.length ? 590 : 846
  if (y + (bodyLines.length - 1) * lineHeight > bodyLimit) {
    ctx.font = `450 49px ${NOTE_BODY_FONT}`
    bodyLines = wrap(ctx, body, width)
    lineHeight = 67
  }
  const linesThatFit = Math.max(0, 1 + Math.floor((bodyLimit - y) / lineHeight))
  for (const [index, line] of (body ? bodyLines.slice(0, linesThatFit) : []).entries()) {
    ctx.fillText(index === linesThatFit - 1 && bodyLines.length > linesThatFit ? ellipsize(ctx, line, width) : line, 108, y, width)
    y += lineHeight
  }
  if (note.task) {
    if (note.doodle && !note.task.rows.length && y < 690) drawDoodle(ctx, note.doodle, 750, 730)
    paintTaskInk(ctx, note.task, NOTE_BODY_FONT, width)
  } else if (note.doodle && y < 770) {
    drawDoodle(ctx, note.doodle, 750, 805)
  }
}

function paintTaskInk(ctx: CanvasRenderingContext2D, task: TaskInk, font: string, width: number) {
  ctx.font = `500 47px ${font}`
  ctx.lineWidth = 4
  for (const [index, row] of task.rows.entries()) {
    const y = 676 + index * 62
    ctx.strokeRect(110, y - 30, 29, 29)
    if (row.done) {
      ctx.beginPath()
      ctx.moveTo(116, y - 17)
      ctx.lineTo(123, y - 9)
      ctx.lineTo(134, y - 24)
      ctx.stroke()
    }
    const text = row.text || 'Untitled item'
    const limit = width - 52
    ctx.fillText(ctx.measureText(text).width > limit ? ellipsize(ctx, text, limit) : text, 160, y, limit)
  }
  const summaryY = task.due ? 886 : 927
  if (task.summary) {
    ctx.font = `600 37px ${font}`
    ctx.fillText(task.summary, 108, summaryY, width)
  }
  if (task.due) {
    ctx.font = `${task.overdue ? 700 : 500} ${task.overdue ? 43 : 39}px ${font}`
    ctx.fillText(task.due, 108, 944, width)
  }
}

export function createNoteTexture(note: NoteArtwork) {
  const { element, context } = canvas(NOTE_TEXTURE_SIZE)
  paintNote(context, note)
  const texture = new CanvasTexture(element)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

export function repaintNoteTexture(texture: CanvasTexture<HTMLCanvasElement>, note: NoteArtwork) {
  const context = texture.image.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  paintNote(context, note)
  texture.needsUpdate = true
}

function drawDoodle(ctx: CanvasRenderingContext2D, doodle: NonNullable<NoteInk['doodle']>, x: number, y: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.lineWidth = 5
  ctx.globalAlpha = 0.8
  if (doodle === 'spark') {
    for (const [a, b, c, d] of [[-55, 0, 55, 0], [0, -55, 0, 55], [-36, -36, 36, 36], [-36, 36, 36, -36]]) {
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke()
    }
    ctx.beginPath(); ctx.arc(75, -55, 4, 0, Math.PI * 2); ctx.fill()
  } else if (doodle === 'flower') {
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3
      ctx.beginPath(); ctx.ellipse(Math.cos(angle) * 32, Math.sin(angle) * 32, 30, 17, angle, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, 65); ctx.quadraticCurveTo(10, 95, -4, 120); ctx.stroke()
  } else {
    ctx.rotate(-0.35)
    ctx.beginPath(); ctx.moveTo(-5, 80); ctx.quadraticCurveTo(20, 10, 0, -70); ctx.stroke()
    for (let i = 0; i < 3; i++) {
      const dy = -42 + i * 38
      ctx.beginPath(); ctx.moveTo(5, dy + 18); ctx.quadraticCurveTo(-60, dy + 10, -35, dy - 18); ctx.quadraticCurveTo(0, dy - 15, 5, dy + 18); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(7, dy + 30); ctx.quadraticCurveTo(65, dy + 8, 40, dy - 8); ctx.quadraticCurveTo(10, dy + 1, 7, dy + 30); ctx.stroke()
    }
  }
  ctx.restore()
}

export function createContactShadow() {
  const { element, context: ctx } = canvas(256)
  ctx.filter = 'blur(18px)'
  ctx.fillStyle = 'rgba(48,50,47,0.13)'
  ctx.fillRect(38, 48, 191, 172)
  ctx.filter = 'blur(8px)'
  ctx.fillStyle = 'rgba(48,50,47,0.115)'
  ctx.fillRect(33, 29, 187, 177)
  ctx.filter = 'blur(4px)'
  ctx.fillStyle = 'rgba(48,50,47,0.16)'
  ctx.fillRect(35, 25, 182, 10)
  return new CanvasTexture(element)
}

export function createWindowLight() {
  const { element, context: ctx } = canvas(512)
  ctx.save()
  ctx.translate(256, 256)
  ctx.rotate(-0.5)
  ctx.filter = 'blur(29px)'
  ctx.fillStyle = 'rgba(81,64,42,0.09)'
  ctx.fillRect(-500, -130, 1000, 65)
  ctx.fillRect(-500, 130, 1000, 65)
  ctx.fillRect(125, -500, 60, 1000)
  ctx.restore()
  const fade = ctx.createRadialGradient(256, 256, 96, 256, 256, 253)
  fade.addColorStop(0, '#fff')
  fade.addColorStop(1, '#fff0')
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, 512, 512)
  return new CanvasTexture(element)
}
