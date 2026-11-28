import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mobileStudyFrame, studyNoteFitsOpening } from '../src/three/mobileStudyFrame.ts'
import { photoCameraTarget, photoWallFrame } from '../src/three/photoWallFrame.ts'
import { getNoteSize } from '../src/utils/noteDimensions.ts'
import { SAMPLE_NOTES, WALL_HEIGHT, WALL_WIDTH } from '../src/utils/constants.ts'
import { replaceUntouchedSamplesWithProfessorStudy } from '../src/utils/onboarding.ts'
import type { WallDocument } from '../src/types/wall.ts'

const sampleWall: WallDocument = {
  notes: replaceUntouchedSamplesWithProfessorStudy(structuredClone(SAMPLE_NOTES)),
  sections: [], wallRotation: [12, -24],
}

test('Professor’s Study sample notes replace only a full, untouched starter set', () => {
  assert.equal(sampleWall.notes.length, 5)
  assert.ok(sampleWall.notes.some((note) => note.checklist?.length && note.doodle))
  const edited = SAMPLE_NOTES.map((note, index) => index ? note : { ...note, title: 'My notes' })
  const partial = SAMPLE_NOTES.slice(0, -1)
  assert.equal(replaceUntouchedSamplesWithProfessorStudy(edited), edited)
  assert.equal(replaceUntouchedSamplesWithProfessorStudy(partial), partial)
})

test('the photo view fits rotated paper inside the workspace across screen sizes', () => {
  for (const [width, height, top, bottom] of [[393, 851, 104, 137], [768, 1024, 108, 117], [1440, 900, 108, 117]]) {
    const view = photoWallFrame(width, height, sampleWall, { left: 0, right: 0, top, bottom })
    const center = photoCameraTarget(view.content, view.centre, view.scale)
    for (const note of sampleWall.notes) {
      const [w, h] = getNoteSize(note)
      const cos = Math.abs(Math.cos(note.rotation)), sin = Math.abs(Math.sin(note.rotation))
      const x = (note.position[0] - center[0]) * view.scale + width / 2
      const y = height / 2 - (note.position[1] - center[1]) * view.scale
      const halfW = (w * cos + h * sin) * view.scale / 2
      const halfH = (w * sin + h * cos) * view.scale / 2
      assert.ok(x - halfW > 0 && x + halfW < width)
      assert.ok(y - halfH > top && y + halfH < height - bottom)
    }
    assert.ok(getNoteSize(sampleWall.notes[0])[0] * view.scale > 100)
  }
})

test('overview covers the original board bounds and archived notes do not affect framing', () => {
  const before = structuredClone(sampleWall)
  const extra: WallDocument = {
    ...sampleWall, notes: [...sampleWall.notes, { ...sampleWall.notes[0], position: [12, 8], archived: true }],
  }
  const insets = { left: 0, right: 0, top: 104, bottom: 140 }
  const view = photoWallFrame(393, 851, extra, insets)
  assert.deepEqual(view, photoWallFrame(393, 851, sampleWall, insets))
  assert.ok(view.min * WALL_WIDTH <= view.areaWidth)
  assert.ok(view.min * WALL_HEIGHT <= view.areaHeight)
  assert.deepEqual(sampleWall, before)
})

const denseWall: WallDocument = {
  wallRotation: [0, 0], sections: [],
  notes: Array.from({ length: 37 }, (_, index) => {
    const row = Math.floor(index / 9), column = index % 9
    const y = [7.8 - column * 0.18, 2 + column * 0.19, -1.53 - column * 0.14, -6.4 + column * 0.112, -4.07][row]
    return { ...SAMPLE_NOTES[0], id: 'dense-' + index, color: 'yellow', position: [-11.2 + column * 2.78, y],
      rotation: [0.035, -0.018, 0.006, 0.023, -0.037][index % 5] }
  }),
}

function assertPaperFitsPhone(document: WallDocument, frame: Pick<ReturnType<typeof mobileStudyFrame>, 'content' | 'scale' | 'centre' | 'areaWidth' | 'areaHeight'>, width: number, height: number) {
  const [targetX, targetY] = photoCameraTarget(frame.content, frame.centre, frame.scale)
  const paperArea = {
    x: width / 2 + frame.centre[0],
    y: height / 2 - frame.centre[1],
  }
  for (const note of document.notes) {
    if (note.archived) continue
    const [w, h] = getNoteSize(note)
    const cos = Math.abs(Math.cos(note.rotation)), sin = Math.abs(Math.sin(note.rotation))
    const x = width / 2 + (note.position[0] - targetX) * frame.scale
    const y = height / 2 - (note.position[1] - targetY) * frame.scale
    const halfW = (w * cos + h * sin) * frame.scale / 2
    const halfH = (w * sin + h * cos) * frame.scale / 2
    assert.ok(Math.abs(x - paperArea.x) + halfW < frame.areaWidth / 2, note.id)
    assert.ok(Math.abs(y - paperArea.y) + halfH < frame.areaHeight / 2, note.id)
  }
  return paperArea
}

test('dense phone home fits a readable cluster while the overview fits every saved note', () => {
  const prior = structuredClone(denseWall)
  const insets = { left: 7, right: 13, top: 166, bottom: 109 }
  for (const [width, height] of [[375, 812], [393, 851], [430, 932]]) {
    const frame = mobileStudyFrame(width, height, denseWall, insets)
    assert.ok(frame.opening)
    const opening = frame.opening
    const visible = denseWall.notes.filter((note) => studyNoteFitsOpening(note, opening))
    assert.ok(visible.length >= 4 && visible.length <= 7)
    const { x, y } = assertPaperFitsPhone({ ...denseWall, notes: visible }, frame, width, height)
    assert.ok(x - frame.areaWidth / 2 > width * 0.16)
    assert.ok(x + frame.areaWidth / 2 < width * 0.84)
    assert.ok(y - frame.areaHeight / 2 > insets.top)
    assert.ok(y + frame.areaHeight / 2 < height - insets.bottom)
    assert.ok(getNoteSize(visible[0])[0] * frame.scale > 95)
    assertPaperFitsPhone(denseWall, { ...frame, ...frame.overview }, width, height)
    assert.ok(frame.overview.scale < frame.scale)
    assert.ok(frame.min <= frame.overview.scale)
    assert.deepEqual(mobileStudyFrame(width, height, denseWall, insets), frame)
  }
  assert.deepEqual(denseWall, prior)
})

test('phone home keeps five large notes readable and disregards archived cards', () => {
  const insets = { left: 0, right: 0, top: 166, bottom: 109 }
  const view = mobileStudyFrame(393, 851, sampleWall, insets)
  assert.equal(view.opening, null)
  assertPaperFitsPhone(sampleWall, view, 393, 851)
  assert.ok(getNoteSize(sampleWall.notes[0])[0] * view.scale > 100)
  assert.deepEqual(mobileStudyFrame(393, 851, {
    ...sampleWall,
    notes: [...sampleWall.notes, { ...sampleWall.notes[0], id: 'archived', position: [-13, 8], archived: true }],
  }, insets), view)
})

test('phone home fits around isolated notes and supports an empty board', () => {
  const positions = [[-12.8, 7.8], [-12, 0.5], [-12.6, -7.5], [12.5, 7.4], [11.8, -0.7], [12.6, -7.1]] as const
  const spread: WallDocument = {
    ...denseWall,
    notes: positions.map(([x, y], index) => ({ ...denseWall.notes[index], position: [x, y] })),
  }
  const empty = { ...spread, notes: [] }
  const insets = { left: 0, right: 0, top: 167, bottom: 112 }
  const view = mobileStudyFrame(393, 851, spread, insets)
  assert.ok(view.opening)
  const opening = view.opening
  const visible = spread.notes.filter((note) => studyNoteFitsOpening(note, opening))
  assert.ok(visible.length > 0 && visible.length < spread.notes.length)
  assertPaperFitsPhone({ ...spread, notes: visible }, view, 393, 851)
  assertPaperFitsPhone(spread, { ...view, ...view.overview }, 393, 851)
  const blankView = mobileStudyFrame(393, 851, empty, insets)
  assert.equal(blankView.opening, null)
  assert.deepEqual(blankView.content, [0, 0])
  assert.ok(Number.isFinite(blankView.scale) && blankView.scale > 0)
  assert.deepEqual(blankView.overview, { content: blankView.content, scale: blankView.scale })
})


test('the compact landscape camera keeps the paper area clear of controls and reaches every saved position', () => {
  const width = 844, height = 390
  const insets = { left: 45, right: 45, top: 66, bottom: 64 }
  const wall: WallDocument = {
    ...denseWall,
    notes: Array.from({ length: 60 }, (_, index) => ({
      ...denseWall.notes[index % denseWall.notes.length],
      id: 'landscape-' + index,
      position: [-12.5 + (index % 10) * 2.75, 7.4 - Math.floor(index / 10) * 3],
    })),
  }
  const saved = structuredClone(wall)
  const frame = mobileStudyFrame(width, height, wall, insets)
  assert.ok(frame.opening)
  const visible = wall.notes.filter((note) => studyNoteFitsOpening(note, frame.opening!))
  assert.ok(visible.length > 0 && visible.length < wall.notes.length)
  assertPaperFitsPhone({ ...wall, notes: visible }, frame, width, height)
  assertPaperFitsPhone(wall, { ...frame, ...frame.overview }, width, height)
  assert.deepEqual(wall, saved)
})
