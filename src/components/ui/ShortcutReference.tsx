const groups = [
  { title: 'Notes', shortcuts: [
    ['N', 'Add a note'],
    ['Enter', 'Edit the selected note'],
    ['Delete / Backspace', 'Delete the selected note'],
    ['Ctrl/⌘ + D', 'Duplicate the selected note'],
    ['Ctrl/⌘ + Z', 'Undo'],
    ['Ctrl/⌘ + Shift + Z or Ctrl/⌘ + Y', 'Redo'],
  ] },
  { title: 'Wall and camera', shortcuts: [
    ['[ / ]', 'Previous / next board'],
    ['Ctrl/⌘ + K', 'Open Find'],
    ['F', 'Focus the selected note'],
    ['V / H / O', 'Select / Pan / Orbit'],
    ['+ or = / −', 'Zoom in / out'],
    ['0', 'Reset the camera'],
    ['Escape', 'Cancel a gesture, exit the tour, or deselect'],
    ['?', 'Open Help'],
  ] },
  { title: 'While editing a note', shortcuts: [
    ['Shift + Enter', 'Add a line in the title or description'],
    ['Enter', 'Finish from the title or description'],
    ['Ctrl/⌘ + Enter', 'Finish editing from any editor field'],
    ['Escape', 'Exit editing. Discard a new note if it is empty.'],
  ] },
]

export function ShortcutReference() {
  return <div className="shortcut-reference">
    {groups.map(({ title, shortcuts }) => <section key={title}>
      <h3>{title}</h3>
      <dl>{shortcuts.map(([keys, action]) => <div key={keys}>
        <dt><kbd>{keys}</kbd></dt><dd>{action}</dd>
      </div>)}</dl>
    </section>)}
  </div>
}
