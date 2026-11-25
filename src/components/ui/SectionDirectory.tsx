import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LocateFixed, PencilLine, Plus, Trash2 } from 'lucide-react'
import type { WallSection } from '../../types/wall'
import { useWallStore } from '../../stores/wallStore'
import { MAX_SECTIONS, MAX_SECTION_NAME } from '../../utils/wallSections'
import { IconButton } from './IconButton'

export function SectionDirectory({ sections, close }: { sections: WallSection[]; close: () => void }) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const actions = useWallStore.getState()
  const full = sections.length >= MAX_SECTIONS

  return <div className="section-directory">
    <form className="add-section" onSubmit={(event) => {
      event.preventDefault()
      const id = actions.createSection(newName)
      if (id) { close(); actions.focusSection(id) }
    }}>
      <input aria-label="New section name" maxLength={MAX_SECTION_NAME} placeholder="Section name" value={newName}
        onChange={(event) => setNewName(event.target.value)} disabled={full} />
      <button className="primary-button" type="submit" disabled={full || !newName.trim()}><Plus size={16} /> Add section</button>
    </form>
    {sections.length > 0
      ? <p className="section-hint">{full ? 'The wall supports up to 24 sections.' : 'In Select mode, drag a label to move its section.'}</p>
      : <p className="panel-empty">Name your first section to group notes on the wall.</p>}
    {sections.map((section) => <div className="section-entry" key={section.id}>
      <div className="section-entry-row">
        <button type="button" className="section-focus" onClick={() => { close(); actions.focusSection(section.id) }}><LocateFixed size={16} /> <span>{section.name}</span></button>
        <IconButton label={`Edit ${section.name}`} aria-expanded={editing === section.id} data-tooltip="Edit section"
          onClick={() => { setEditing(editing === section.id ? null : section.id); setName(section.name) }}><PencilLine size={16} /></IconButton>
      </div>
      {editing === section.id && <form className="edit-section" onSubmit={(event) => {
        event.preventDefault()
        actions.renameSection(section.id, name)
        setEditing(null)
      }}>
        <div className="add-section">
          <input aria-label="Rename section" autoFocus maxLength={MAX_SECTION_NAME} value={name} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="primary-button" disabled={!name.trim()}>Save name</button>
        </div>
        <div className="section-edit-actions">
          <div className="section-nudge" role="group" aria-label="Move section">
            <IconButton label="Move section left" onClick={() => actions.moveSection(section.id, [section.position[0] - 0.5, section.position[1]])}><ArrowLeft size={15} /></IconButton>
            <IconButton label="Move section right" onClick={() => actions.moveSection(section.id, [section.position[0] + 0.5, section.position[1]])}><ArrowRight size={15} /></IconButton>
            <IconButton label="Move section up" onClick={() => actions.moveSection(section.id, [section.position[0], section.position[1] + 0.5])}><ArrowUp size={15} /></IconButton>
            <IconButton label="Move section down" onClick={() => actions.moveSection(section.id, [section.position[0], section.position[1] - 0.5])}><ArrowDown size={15} /></IconButton>
          </div>
          <button type="button" className="text-button danger" onClick={() => { actions.deleteSection(section.id); setEditing(null) }}><Trash2 size={15} /> Delete</button>
        </div>
      </form>}
    </div>)}
  </div>
}
