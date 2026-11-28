import { useState } from 'react'
import { Compass, Hand, MousePointer2, ZoomIn, PencilLine } from 'lucide-react'
import { Modal } from './Modal'
import { useWallStore } from '../../stores/wallStore'
import { ShortcutReference } from './ShortcutReference'

export function HelpDialog({ compact = false }: { compact?: boolean } = {}) {
  const [view, setView] = useState<'guide' | 'shortcuts'>('guide')
  const tutorial = useWallStore((s) => s.tutorial)
  const { setPanel, startTutorial, exitTutorial } = useWallStore.getState()
  return <Modal title="Using your wall" onClose={() => setPanel('helpOpen', false)} className="help-modal">
    <div className="help-walkthrough">
      <button type="button" className="primary-button" onClick={startTutorial}><Compass size={16} /> {tutorial === null ? 'Start walkthrough' : 'Restart walkthrough'}</button>
      {tutorial !== null && <button type="button" className="text-button" onClick={exitTutorial}>Exit walkthrough</button>}
    </div>
    <div className="task-panel-views" role="group" aria-label="Help views">
      <button type="button" aria-pressed={view === 'guide'} onClick={() => setView('guide')}>Wall guide</button>
      <button type="button" aria-pressed={view === 'shortcuts'} onClick={() => setView('shortcuts')}>Keyboard shortcuts</button>
    </div>
    {view === 'shortcuts' ? <ShortcutReference /> : <dl className="help-list">
      <div><MousePointer2 /><dt>Arrange your thoughts</dt><dd>In select mode, drag a note anywhere on the wall.</dd></div>
      <div><PencilLine /><dt>Edit and resize notes</dt><dd>Select a note on the wall or from search. Press Enter or choose Edit. Drag a corner or use the Resize buttons. Escape cancels an active drag.</dd></div>
      <div><Hand /><dt>Look around</dt><dd>Choose the hand tool and drag, or right-drag at any time. Use two fingers on a touch screen.</dd></div>
      <div><ZoomIn /><dt>A little closer</dt><dd>{compact ? 'Pinch to zoom or tap Focus note to read one. Tap Fit whole board for an overview, or choose Reset view in More wall tools.' : 'Scroll or pinch to zoom. The frame button brings you home.'}</dd></div>
    </dl>}
  </Modal>
}
