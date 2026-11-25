import { Hand, MousePointer2, Orbit, Move3D, ZoomIn, PencilLine, Keyboard } from 'lucide-react'
import { Modal } from './Modal'
import { useWallStore } from '../../stores/wallStore'

export function HelpDialog() {
  return <Modal title="Using your wall" onClose={() => useWallStore.getState().setPanel('helpOpen', false)} className="help-modal">
    <dl className="help-list">
      <div><MousePointer2 /><dt>Arrange your thoughts</dt><dd>In select mode, drag a note anywhere on the wall.</dd></div>
      <div><PencilLine /><dt>Edit and resize notes</dt><dd>Select a note on the wall or from search. Press Enter or choose Edit. Drag a corner or use the Resize buttons. Escape cancels an active drag.</dd></div>
      <div><Hand /><dt>Look around</dt><dd>Choose the hand tool and drag, or right-drag at any time. Use two fingers on a touch screen.</dd></div>
      <div><ZoomIn /><dt>A little closer</dt><dd>Scroll or pinch to zoom. The frame button brings you home.</dd></div>
      <div><Orbit /><dt>Change your perspective</dt><dd>Choose the orbit tool and drag to move the camera around the wall.</dd></div>
      <div><Move3D /><dt>Turn the wall itself</dt><dd>Use Rotate wall to tilt or turn it. Your notes stay attached.</dd></div>
    </dl>
    <div className="keyboard-hints"><Keyboard size={17} /><span><kbd>N</kbd> New note <kbd>V</kbd> Select <kbd>H</kbd> Pan <kbd>O</kbd> Orbit <kbd>0</kbd> Reset</span></div>
  </Modal>
}
