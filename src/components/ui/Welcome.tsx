import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import type { FirstWallOptions } from '../../utils/onboarding'
import { NoteColorPicker, ThemePicker } from './AppearancePickers'
import { IconButton } from './IconButton'

export function Welcome() {
  const [setup, setSetup] = useState(false)
  const [theme, setTheme] = useState(() => useWallStore.getState().appearance.theme)
  const [color, setColor] = useState(() => useWallStore.getState().noteDefaults.color)
  const [starter, setStarter] = useState<FirstWallOptions['starter']>('samples')
  const heading = useRef<HTMLHeadingElement>(null)
  const complete = useWallStore.getState().completeOnboarding

  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }) }, [setup])

  function dismiss() {
    complete({ starter: 'samples', offerTutorial: false })
    document.querySelector<HTMLElement>('[data-tour-anchor="add"]')?.focus({ preventScroll: true })
  }

  return <section className={`onboarding-card ${setup ? 'wall-setup' : 'wall-welcome'}`} aria-labelledby="wall-welcome-title"
    onKeyDown={(event) => {
      if (event.key !== 'Escape') return
      if (setup) setSetup(false)
      else dismiss()
      event.preventDefault()
      event.stopPropagation()
    }}>
    <div className="onboarding-top">
      {setup ? <button type="button" className="text-button onboarding-back" onClick={() => setSetup(false)}><ArrowLeft size={14} /> Back</button>
        : <span className="welcome-brand"><img src="/favicon.svg" alt="" /> WALLFLOW</span>}
      <IconButton label="Dismiss welcome" onClick={dismiss}><X size={16} /></IconButton>
    </div>
    {setup ? <>
      <h1 id="wall-welcome-title" ref={heading} tabIndex={-1}>Set up my wall</h1>
      <form onSubmit={(event) => { event.preventDefault(); complete({ starter, theme, color }) }}>
        <ThemePicker value={theme} onChange={setTheme} />
        <NoteColorPicker value={color} onChange={setColor} />
        <fieldset className="starter-choice">
          <legend>Start with</legend>
          <label><input type="radio" name="starter-wall" checked={starter === 'samples'} onChange={() => setStarter('samples')} /> Sample notes</label>
          <label><input type="radio" name="starter-wall" checked={starter === 'blank'} onChange={() => setStarter('blank')} /> Blank wall</label>
        </fieldset>
        <button type="submit" className="primary-button onboarding-open">Open my wall <ArrowRight size={16} /></button>
      </form>
    </> : <>
      <h1 id="wall-welcome-title" ref={heading} tabIndex={-1}>Your thoughts. Your space. Your wall.</h1>
      <p>Your personal 3D workspace for writing and arranging sticky notes.</p>
      <div className="onboarding-actions">
        <button type="button" className="primary-button" onClick={() => setSetup(true)}>Set up my wall <ArrowRight size={16} /></button>
        <button type="button" className="text-button" onClick={() => complete({ starter: 'blank' })}>Start with a blank wall</button>
      </div>
    </>}
  </section>
}
