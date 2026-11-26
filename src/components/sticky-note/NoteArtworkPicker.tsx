import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { EMOJI_FONTS } from '../../utils/appearance'
import { EMOJI_CATEGORIES, NOTE_EMOJIS } from '../../utils/noteEmoji'
import { matchesNoteArtwork, moveArtworkFocus } from '../../utils/noteText'
import { isSketchId, SKETCHES, SKETCH_CATEGORIES, SKETCH_IDS } from '../../utils/sketches'
import type { SketchId } from '../../utils/sketches'
import type { StickyNoteData } from '../../types/wall'
import { NoteSketch } from './NoteSketch'

export type ArtworkPickerKind = 'emoji' | 'symbols'
export type SketchPlacement = 'corner' | 'inline'
const sketchEntries = SKETCH_IDS.map((id) => ({ ...SKETCHES[id], id }))
const emojis = NOTE_EMOJIS.map((entry) => ({ ...entry, id: entry.glyph }))

export function NoteArtworkPicker({ kind, doodle, close, insertEmoji, selectSketch, removeSketch }: {
  kind: ArtworkPickerKind; doodle?: StickyNoteData['doodle']; close: () => void;
  insertEmoji: (emoji: string, name: string) => void;
  selectSketch: (id: SketchId, placement: SketchPlacement) => void; removeSketch: () => void
}) {
  const isEmoji = kind === 'emoji'
  const categories = isEmoji ? EMOJI_CATEGORIES : SKETCH_CATEGORIES
  const catalog = isEmoji ? emojis : sketchEntries
  const [category, setCategory] = useState<string>(() => !isEmoji && isSketchId(doodle) ? SKETCHES[doodle].category : categories[0])
  const [query, setQuery] = useState('')
  const [placement, setPlacement] = useState<SketchPlacement>('corner')
  const [active, setActive] = useState(0)
  const titleId = useId()
  const search = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const results = catalog.filter((entry) => query.trim() ? matchesNoteArtwork(entry, query) || entry.id === query.trim() : entry.category === category)
  const focusResult = (index: number) => grid.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus()
  const choose = (entry: typeof results[number]) => {
    if (isEmoji) insertEmoji(entry.id, entry.name)
    else if (isSketchId(entry.id)) selectSketch(entry.id, placement)
  }
  useLayoutEffect(() => {
    search.current?.focus({ preventScroll: true })
    panel.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])
  return <div ref={panel} className="note-artwork-panel" data-note-artwork-panel role="group" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation() }}>
    <div className="note-artwork-heading"><strong id={titleId}>{isEmoji ? 'Emoji' : 'Hand-drawn symbols'}</strong>
      <button type="button" aria-label="Close picker" title="Close picker" onClick={close}><X size={16} aria-hidden="true" /></button>
    </div>
    <label className="note-artwork-search"><Search size={15} aria-hidden="true" />
      <input ref={search} type="search" aria-label={isEmoji ? 'Search emoji' : 'Search symbols'} placeholder={isEmoji ? 'Search emoji' : 'Search symbols'}
        value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' && results.length) {
            event.preventDefault()
            focusResult(0)
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            if (results[0]) choose(results[0])
          }
        }} />
    </label>
    {!query.trim() && <div className="note-artwork-categories" role="group" aria-label="Categories">
      {categories.map((name) => <button key={name} type="button" aria-pressed={category === name}
        onClick={() => { setCategory(name); setActive(0) }}>{name}</button>)}
    </div>}
    {!isEmoji && <div className="note-sketch-placement" role="group" aria-label="Illustration placement">
      <button type="button" aria-pressed={placement === 'corner'} onClick={() => setPlacement('corner')}>Note corner</button>
      <button type="button" aria-pressed={placement === 'inline'} onClick={() => setPlacement('inline')}>At text cursor</button>
    </div>}
    <div ref={grid} className={isEmoji ? 'note-artwork-grid emoji-grid' : 'note-artwork-grid sketch-grid'}
      onKeyDown={(event) => {
        const next = moveArtworkFocus(event.key, active, results.length, isEmoji ? 6 : 4)
        if (next === null) return
        event.preventDefault()
        focusResult(next)
      }}>
      {results.map((entry, index) => <button key={entry.id} type="button" title={entry.name} aria-label={entry.name}
        tabIndex={index === active ? 0 : -1}
        aria-pressed={!isEmoji && placement === 'corner' ? entry.id === doodle : undefined}
        onFocus={() => setActive(index)} onClick={() => choose(entry)}>
        {isEmoji ? <span style={{ fontFamily: EMOJI_FONTS }}>{entry.id}</span> : isSketchId(entry.id) && <>
          <NoteSketch id={entry.id} /><span>{entry.name}</span>
        </>}
      </button>)}
      {!results.length && <p className="note-artwork-empty">No {isEmoji ? 'emoji' : 'symbols'} match your search.</p>}
    </div>
    {!isEmoji && doodle && <button className="note-remove-sketch" type="button" onClick={removeSketch}>Remove corner illustration</button>}
  </div>
}
