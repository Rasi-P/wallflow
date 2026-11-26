import { isSketchId } from './sketches.ts'
import type { SketchId } from './sketches.ts'

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null

export function noteGraphemes(text: string) {
  if (segmenter) return Array.from(segmenter.segment(text), ({ segment }) => segment)
  return text.match(/\r\n|\p{Regional_Indicator}{2}|[\s\S](?:\p{Mark}|\p{Emoji_Modifier})*(?:\u200d[\s\S](?:\p{Mark}|\p{Emoji_Modifier})*)*/gu) ?? []
}

export function limitNoteText(text: string, length: number) {
  if (text.length <= length) return text
  let end = 0
  for (const part of segmenter ? segmenter.segment(text) : noteGraphemes(text)) {
    const size = typeof part === 'string' ? part.length : part.segment.length
    if (end + size > length) break
    end += size
  }
  return text.slice(0, end)
}

export function insertNoteText(text: string, start: number, end: number, insertion: string, limit: number) {
  const value = text.slice(0, start) + insertion + text.slice(end)
  return value.length <= limit ? { value, cursor: start + insertion.length } : null
}

export const sketchMarker = (id: SketchId) => `[[sketch:${id}]]`

export function inlineNoteParts(text: string) {
  const parts: (string | { sketch: SketchId })[] = []
  let end = 0
  for (const match of text.matchAll(/\[\[sketch:([a-z-]+)\]\]/g)) {
    if (!isSketchId(match[1])) continue
    if (match.index > end) parts.push(text.slice(end, match.index))
    parts.push({ sketch: match[1] })
    end = match.index + match[0].length
  }
  if (end < text.length) parts.push(text.slice(end))
  return parts
}

export function matchesNoteArtwork(entry: { name: string; keywords: string; category: string }, query: string) {
  const text = `${entry.name} ${entry.keywords} ${entry.category}`.toLowerCase()
  return query.toLowerCase().trim().split(/\s+/).every((term) => text.includes(term))
}

export function moveArtworkFocus(key: string, active: number, count: number, columns: number) {
  const moves: Record<string, number> = { ArrowRight: active + 1, ArrowLeft: active - 1, ArrowDown: active + columns,
    ArrowUp: active - columns, Home: 0, End: count - 1 }
  return count && Object.hasOwn(moves, key) ? Math.max(0, Math.min(count - 1, moves[key])) : null
}
