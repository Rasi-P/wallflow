import { isSketchId, SKETCHES, SKETCH_DETAIL_WIDTH, SKETCH_OUTLINE_WIDTH } from '../../utils/sketches'
import type { SketchId } from '../../utils/sketches'

const legacySketches = {
  spark: { outline: 'M12 32 L50 32 M31 13 L31 51 M17 18 L46 46 M45 18 L17 46', detail: 'M54 13 A1.6 1.6 0 1 0 54 16.2 A1.6 1.6 0 0 0 54 13' },
  flower: { outline: 'M30 29 C13 24 16 14 23 15 Q30 16 32 27 C30 9 44 9 43 18 Q41 25 36 29 C55 24 56 37 47 39 Q42 38 36 35 C44 52 33 55 31 47 L31 37 C24 51 15 42 18 37 Q23 32 30 32 Z M31 48 L31 58', detail: 'M32 28 A4 4 0 1 0 32 36 A4 4 0 0 0 32 28' },
  leaf: { outline: 'M18 52 Q27 39 45 13 M25 43 C10 43 12 27 17 26 Q26 28 26 41 M30 36 C45 40 51 27 47 24 Q37 26 31 35 M36 27 C27 25 27 14 34 11 Q40 15 36 26', detail: 'M20 54 L25 50' },
}

export function NoteSketch({ id, size = 32 }: { id: SketchId | keyof typeof legacySketches; size?: number }) {
  const { outline, detail } = isSketchId(id) ? SKETCHES[id] : legacySketches[id]
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 64 64"
    fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d={outline} strokeWidth={SKETCH_OUTLINE_WIDTH} />
    <path d={detail} strokeWidth={SKETCH_DETAIL_WIDTH} opacity={0.8} />
    <path d={outline} strokeWidth={0.81} opacity={0.21} transform="translate(.66 -.4)" />
  </svg>
}
