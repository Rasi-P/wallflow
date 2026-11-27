import type { StickyNoteData } from '../src/types/wall.ts'

const rear: StickyNoteData = {
  id: 'overlap-rear', title: 'Rear research 🔬', body: 'Reference details behind the front sheet.', color: 'pink',
  position: [0, 0.7], rotation: 0,
  priority: 'high', checklist: [{ id: 'review', text: 'Review notes ✅', done: true }],
  doodle: 'open-book',
}
const front: StickyNoteData = {
  id: 'overlap-front', title: 'Front paper', body: 'The paper on top.', color: 'blue',
  position: [0.9, -0.7], rotation: 0,
}

export const overlapNotes = {
  partial: [rear, front],
  rotated: [
    { ...rear, position: [-0.7, 0.8], rotation: 0.19 },
    { ...front, id: 'overlap-middle', title: 'Middle checklist', color: 'green', position: [0.08, 0.18], rotation: -0.23 },
    { ...front, position: [0.72, -0.57], rotation: 0.27, doodle: 'light-bulb' },
  ],
  covered: [
    { ...rear, position: [0, 0], rotation: 0.03 },
    { ...front, position: [0.08, 0.04], rotation: 0.03, size: [2.69, 2.84] },
  ],
} satisfies Record<string, StickyNoteData[]>
