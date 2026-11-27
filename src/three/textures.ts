import { CanvasTexture, SRGBColorSpace } from 'three'
import type { StickyNoteData } from '../types/wall.ts'
import { NOTE_COLORS } from '../utils/constants.ts'
import type { TaskInk } from '../utils/noteTasks.ts'
import { NOTE_BODY_FONT, NOTE_TITLE_FONTS } from '../utils/appearance.ts'
import { inlineNoteParts, noteGraphemes, sketchMarker } from '../utils/noteText.ts'
import { isSketchId, SKETCHES, SKETCH_DETAIL_WIDTH, SKETCH_OUTLINE_WIDTH } from '../utils/sketches.ts'
import type { SketchId } from '../utils/sketches.ts'

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

const sketchPaths = new Map<SketchId, readonly [Path2D, Path2D]>()

function sketchSize(size: number, aspect: number) {
  return { width: size * Math.min(1, 1 / aspect), height: size * Math.min(1, aspect) }
}

function paintSketch(ctx: CanvasRenderingContext2D, id: SketchId, x: number, y: number, width: number, height: number) {
  let paths = sketchPaths.get(id)
  if (!paths) {
    paths = [new Path2D(SKETCHES[id].outline), new Path2D(SKETCHES[id].detail)]
    sketchPaths.set(id, paths)
  }
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(width / 64, height / 64)
  ctx.globalAlpha = 0.82
  ctx.lineWidth = SKETCH_OUTLINE_WIDTH
  ctx.stroke(paths[0])
  ctx.globalAlpha = 0.66
  ctx.lineWidth = SKETCH_DETAIL_WIDTH
  ctx.stroke(paths[1])
  ctx.translate(0.66, -0.4)
  ctx.globalAlpha = 0.19
  ctx.lineWidth = 0.81
  ctx.stroke(paths[0])
  ctx.restore()
}

function lineWriter(ctx: CanvasRenderingContext2D, fontSize: number, inline?: true, aspect = 1) {
  const { width, height } = sketchSize(fontSize * 0.94, aspect)
  const advance = width + fontSize * 0.17
  const measure = (text: string) => inline && text.includes('[[sketch:')
    ? inlineNoteParts(text).reduce((sum, part) => sum + (typeof part === 'string' ? ctx.measureText(part).width : advance), 0)
    : ctx.measureText(text).width
  return {
    measure,
    units: (text: string) => inline && text.includes('[[sketch:')
      ? inlineNoteParts(text).flatMap((part) => typeof part === 'string' ? noteGraphemes(part) : [sketchMarker(part.sketch)])
      : noteGraphemes(text),
    fill(text: string, x: number, y: number, maxWidth: number) {
      if (!inline || !text.includes('[[sketch:')) {
        ctx.fillText(text, x, y, maxWidth)
        return
      }
      for (const part of inlineNoteParts(text)) {
        if (typeof part === 'string') {
          ctx.fillText(part, x, y)
          x += ctx.measureText(part).width
        } else {
          paintSketch(ctx, part.sketch, x + (advance - width) / 2, y - height * 0.84, width, height)
          x += advance
        }
      }
    },
  }
}

function wrap(writer: ReturnType<typeof lineWriter>, text: string, maxWidth: number) {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (writer.measure(candidate) > maxWidth && line) { lines.push(line); line = word }
      else line = candidate
      // Split long unbroken words so user text stays on the paper.
      while (writer.measure(line) > maxWidth) {
        const characters = writer.units(line)
        if (characters.length <= 1) break
        let end = characters.length - 1
        while (end > 1 && writer.measure(characters.slice(0, end).join('')) > maxWidth) end--
        lines.push(characters.slice(0, end).join(''))
        line = characters.slice(end).join('')
      }
    }
    lines.push(line)
  }
  return lines
}

function ellipsize(writer: ReturnType<typeof lineWriter>, line: string, width: number) {
  const characters = writer.units(line.trimEnd())
  while (characters.length && writer.measure(`${characters.join('')}…`) > width) characters.pop()
  return `${characters.join('')}…`
}

export const NOTE_TEXTURE_SIZE = 1024
export const DEFAULT_NOTE_TITLE = 'A fresh little thought.'
export const DEFAULT_NOTE_BODY = 'Double-click to make it yours.'
export type NoteInk = Pick<StickyNoteData, 'title' | 'body' | 'doodle' | 'typography' | 'inlineSketches'> & {
  task?: TaskInk; sketchAspect?: number; phone?: true; largerInk?: boolean
}
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
  if (note.phone) {
    const light = ctx.createLinearGradient(0, 0, NOTE_TEXTURE_SIZE, NOTE_TEXTURE_SIZE)
    light.addColorStop(0, '#fff9e624')
    light.addColorStop(0.6, '#fff9e600')
    light.addColorStop(1, '#764c1611')
    ctx.fillStyle = light
    ctx.fillRect(0, 0, NOTE_TEXTURE_SIZE, NOTE_TEXTURE_SIZE)
  }
  paintNoteInk(ctx, note, ink)
}

export function paintNoteInk(ctx: CanvasRenderingContext2D, note: NoteInk, ink: string) {
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const titleFont = NOTE_TITLE_FONTS[note.typography ?? 'handwritten']
  const bodyFont = note.typography === 'sans' ? NOTE_BODY_FONT : titleFont
  const title = note.title || DEFAULT_NOTE_TITLE
  const width = 800
  const corner = isSketchId(note.doodle) ? note.doodle : undefined
  const aspect = note.sketchAspect ?? 1
  const titleSize = note.largerInk ? 124 : note.phone ? 111 : 95
  ctx.font = `700 ${titleSize}px ${titleFont}`
  let titleWriter = lineWriter(ctx, titleSize, note.inlineSketches, aspect)
  let titleLines = wrap(titleWriter, title, width)
  if (titleLines.length > 2) {
    const reduced = note.largerInk ? 97 : note.phone ? 89 : 77
    ctx.font = `700 ${reduced}px ${titleFont}`
    titleWriter = lineWriter(ctx, reduced, note.inlineSketches, aspect)
    titleLines = wrap(titleWriter, title, width)
  }
  let y = note.phone ? 171 : 175
  for (const [index, line] of titleLines.slice(0, 3).entries()) {
    titleWriter.fill(index === 2 && titleLines.length > 3 ? ellipsize(titleWriter, line, width) : line, 108, y, width)
    y += note.largerInk ? 119 : note.phone ? 111 : 105
  }
  y += 25
  const body = note.body || (note.task ? '' : DEFAULT_NOTE_BODY)
  const bodySize = note.largerInk ? 91 : note.phone ? 84 : 62
  const bodyWeight = note.phone ? 600 : 500
  ctx.font = `${bodyWeight} ${bodySize}px ${bodyFont}`
  let bodyWriter = lineWriter(ctx, bodySize, note.inlineSketches, aspect)
  let bodyLines = wrap(bodyWriter, body, width)
  let lineHeight = note.phone ? 94 : 79
  const bodyLimit = note.task?.rows.length ? (note.largerInk ? 552 : 590) : corner ? 736 : 846
  if (y + (bodyLines.length - 1) * lineHeight > bodyLimit) {
    const reduced = note.phone ? 67 : 52
    ctx.font = `${bodyWeight} ${reduced}px ${bodyFont}`
    bodyWriter = lineWriter(ctx, reduced, note.inlineSketches, aspect)
    bodyLines = wrap(bodyWriter, body, width)
    lineHeight = note.phone ? 82 : 67
  }
  const linesThatFit = Math.max(0, 1 + Math.floor((bodyLimit - y) / lineHeight))
  for (const [index, line] of (body ? bodyLines.slice(0, linesThatFit) : []).entries()) {
    bodyWriter.fill(index === linesThatFit - 1 && bodyLines.length > linesThatFit ? ellipsize(bodyWriter, line, width) : line, 108, y, width)
    y += lineHeight
  }
  if (note.task) {
    if (note.doodle && !corner && !note.task.rows.length && y < 690) drawDoodle(ctx, note.doodle, 750, 730)
    const firstRow = Math.min(note.phone ? 630 : 657, Math.max(335, y + 20))
    paintTaskInk(ctx, note.task, bodyFont, width, Boolean(corner), firstRow, note)
  } else if (note.doodle && !corner && y < 770) {
    drawDoodle(ctx, note.doodle, 750, 805)
  }
  if (corner) {
    const dimensions = sketchSize(150, aspect)
    paintSketch(ctx, corner, 910 - dimensions.width, 914 - dimensions.height, dimensions.width, dimensions.height)
  }
}

function paintTaskInk(ctx: CanvasRenderingContext2D, task: TaskInk, font: string, width: number, corner: boolean, firstRow: number, { phone, largerInk }: NoteInk) {
  const fontSize = largerInk ? 93 : phone ? 86 : 59
  const boxSize = phone ? 39 : 32
  ctx.font = `${phone ? 600 : 500} ${fontSize}px ${font}`
  ctx.lineWidth = 4
  for (const [index, row] of task.rows.entries()) {
    const y = firstRow + index * (largerInk ? 96 : phone ? 86 : 68)
    ctx.strokeRect(110, y - boxSize - 2, boxSize, boxSize)
    if (row.done) {
      ctx.beginPath()
      ctx.moveTo(116, y - 17)
      ctx.lineTo(123, y - 9)
      ctx.lineTo(134, y - 24)
      ctx.stroke()
    }
    const text = row.text || 'Untitled item'
    const limit = (corner && y > 751 ? 632 : width) - 52
    ctx.fillText(ctx.measureText(text).width > limit ? ellipsize(lineWriter(ctx, fontSize), text, limit) : text, 160, y, limit)
  }
  const summaryY = task.due ? 886 : 927
  if (task.summary) {
    ctx.font = `600 37px ${font}`
    ctx.fillText(task.summary, 108, summaryY, corner ? 632 : width)
  }
  if (task.due) {
    ctx.font = `${task.overdue ? 700 : 500} ${task.overdue ? 43 : 39}px ${font}`
    ctx.fillText(task.due, 108, 944, corner ? 632 : width)
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
  const shade = (radius: number, fill: string, x: number, y: number, width: number, height: number) => {
    ctx.filter = `blur(${radius}px)`
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 6)
    ctx.fill()
  }
  shade(14, 'rgba(74,41,19,0.30)', 43, 50, 187, 179)
  shade(7, 'rgba(61,39,24,0.20)', 40, 41, 186, 182)
  shade(3, 'rgba(45,27,18,0.18)', 38, 41, 183, 16)
  const texture = new CanvasTexture(element)
  texture.colorSpace = SRGBColorSpace
  return texture
}
