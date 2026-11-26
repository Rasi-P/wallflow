import type { Point2, StickyNoteData, WallDocument, WallSection } from '../types/wall.ts'
import { NOTE_WIDTH, WALL_HEIGHT, WALL_WIDTH } from '../utils/constants.ts'
import { getNoteSize } from '../utils/noteDimensions.ts'
import { SECTION_HEIGHT, SECTION_WIDTH } from '../utils/wallSections.ts'
import { wallContentBounds } from './photoWallFrame.ts'
import type { WallFrameInsets } from './photoWallFrame.ts'

export type StudyOpening = { left: number; right: number; top: number; bottom: number }
type StudyView = { content: Point2; scale: number }
type Paper = { box: StudyOpening; position: Point2; width: number; height: number }

// The empty plaster in the portrait assets, expressed in uncropped image coordinates.
const plaster = { left: 0.16, right: 0.84, top: 0.195, bottom: 0.855 }

function rectangle([x, y]: Point2, width: number, height: number): StudyOpening {
  return { left: x - width / 2, right: x + width / 2, top: y + height / 2, bottom: y - height / 2 }
}

export function studyOpeningAt(content: Point2, areaWidth: number, areaHeight: number, scale: number) {
  return rectangle(content, areaWidth / scale, areaHeight / scale)
}

function contains(outer: StudyOpening, inner: StudyOpening) {
  const tolerance = 0.00001
  return outer.left - tolerance <= inner.left && inner.right <= outer.right + tolerance &&
    outer.bottom - tolerance <= inner.bottom && inner.top <= outer.top + tolerance
}

function paperFootprint(note: StickyNoteData): Paper {
  const [w, h] = getNoteSize(note)
  const cos = Math.abs(Math.cos(note.rotation)), sin = Math.abs(Math.sin(note.rotation))
  const width = w * cos + h * sin, height = w * sin + h * cos
  // The opening also has room for the contact shadow and anything attached at the paper edge.
  return { box: rectangle(note.position, width + w * 0.12, height + h * 0.16), position: note.position, width, height }
}

export function studyNoteFitsOpening(note: StickyNoteData, opening: StudyOpening) {
  return contains(opening, paperFootprint(note).box)
}

export function studySectionFitsOpening(section: WallSection, opening: StudyOpening) {
  return contains(opening, rectangle(section.position, SECTION_WIDTH, SECTION_HEIGHT))
}

function candidateCentres(papers: Paper[], low: 'left' | 'bottom', high: 'right' | 'top', span: number) {
  const values = new Set<number>()
  for (const { box } of papers) {
    values.add(box[low] + span / 2)
    values.add(box[high] - span / 2)
    values.add((box[low] + box[high]) / 2)
  }
  return values
}

function clusterBounds(papers: Paper[]) {
  return papers.reduce((a, { box }) => ({
    left: Math.min(a.left, box.left), right: Math.max(a.right, box.right),
    bottom: Math.min(a.bottom, box.bottom), top: Math.max(a.top, box.top),
  }), papers[0].box)
}

function overlapCost(papers: Paper[]) {
  let cost = 0
  for (let i = 0; i < papers.length; i++) {
    const a = papers[i], [x, y] = a.position
    for (let j = 0; j < i; j++) {
      const b = papers[j]
      const across = Math.max(0, (a.width + b.width) / 2 - Math.abs(x - b.position[0]))
      const down = Math.max(0, (a.height + b.height) / 2 - Math.abs(y - b.position[1]))
      cost += across * down / Math.min(a.width * a.height, b.width * b.height)
    }
  }
  return cost
}

function rowGapCost(papers: Paper[], scale: number) {
  const rowCentres: number[] = []
  for (const { position: [, y], height } of papers) {
    if (rowCentres.every((row) => Math.abs(row - y) > height * 0.6)) rowCentres.push(y)
  }
  rowCentres.sort((a, b) => a - b)
  if (rowCentres.length < 3) return 0
  const gaps = rowCentres.slice(1).map((y, index) => (y - rowCentres[index]) * scale)
  return (Math.max(...gaps) - Math.min(...gaps)) / 110
}

function chooseCluster(papers: Paper[], ideal: number, areaWidth: number, areaHeight: number, centre: Point2) {
  let best: (StudyView & { score: number }) | undefined
  // Sample several reading scales and fit whole papers at the edges of each possible view.
  for (const factor of [1.1, 1, 0.91, 0.81, 0.73]) {
    const w = areaWidth / (ideal * factor), h = areaHeight / (ideal * factor)
    for (const x of candidateCentres(papers, 'left', 'right', w)) {
      const columns = papers.filter(({ box }) => box.left >= x - w / 2 - 0.00001 && box.right <= x + w / 2 + 0.00001)
      if (!columns.length) continue
      for (const y of candidateCentres(columns, 'bottom', 'top', h)) {
        const window = rectangle([x, y], w, h)
        const cluster = columns.filter(({ box }) => contains(window, box))
        if (!cluster.length) continue

        const { left, right, top, bottom } = clusterBounds(cluster)
        const content: Point2 = [(left + right) / 2, (bottom + top) / 2]
        const scale = Math.min(ideal * 1.1, areaWidth / (right - left), areaHeight / (top - bottom))
        const verticalUse = scale * (top - bottom) / areaHeight
        const distance = Math.hypot(content[0] - centre[0], content[1] - centre[1])
        // Reward a useful group and larger type. Avoid needless spans of blank wall and paper overlap.
        const score = Math.min(cluster.length, 6) * 2.3 - Math.max(0, cluster.length - 6) * 0.5 +
          scale / ideal * 6 + verticalUse * 1.2 - overlapCost(cluster) * 4 - rowGapCost(cluster, scale) * 1.9 - distance * 0.11
        if (!best || score > best.score) best = { content, scale, score }
      }
    }
  }
  return best
}

export function mobileStudyFrame(width: number, height: number, document: WallDocument, insets: WallFrameInsets) {
  const left = Math.max(width * plaster.left, insets.left) + 8
  const right = Math.min(width * plaster.right, width - insets.right) - 8
  const top = Math.max(height * plaster.top, insets.top) + 8
  const bottom = Math.min(height * plaster.bottom, height - insets.bottom) - 10
  const areaWidth = Math.max(1, right - left)
  const areaHeight = Math.max(1, bottom - top)
  const centre: Point2 = [(left + right - width) / 2, (height - top - bottom) / 2]
  const { content: boardCentre, spanX, spanY } = wallContentBounds(document)
  const fit = Math.min(areaWidth / Math.max(spanX, 7.6), areaHeight / Math.max(spanY, 10))
  const overview: StudyView = { content: boardCentre, scale: fit }

  const notes = document.notes.filter((note) => !note.archived)
  const widths = notes.map((note) => getNoteSize(note)[0]).sort((a, b) => a - b)
  const ideal = areaWidth * 0.44 / (widths[Math.floor(widths.length / 2)] ?? NOTE_WIDTH)
  const cluster = notes.length > 1 && fit < ideal * 0.8
    ? chooseCluster(notes.map(paperFootprint), ideal, areaWidth, areaHeight, boardCentre)
    : undefined
  const { content, scale } = cluster ?? overview

  return {
    content, centre, areaWidth, areaHeight, scale, overview,
    opening: cluster ? studyOpeningAt(content, areaWidth, areaHeight, scale) : null,
    min: Math.min(fit * 0.8, areaWidth / WALL_WIDTH, areaHeight / WALL_HEIGHT),
    max: Math.max(scale * 2.5, areaWidth / 2),
  }
}
