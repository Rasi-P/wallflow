import { useLayoutEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, Compass, Move, PencilLine, Plus, Scaling, Search, X } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import { TUTORIAL_STEPS } from '../../utils/onboarding'
import type { TutorialProgress } from '../../utils/onboarding'
import { IconButton } from './IconButton'

const icons = { add: Plus, edit: PencilLine, move: Move, resize: Scaling, find: Search, tasks: CalendarDays, camera: Compass }

export function WallTutorial({ progress }: { progress: Exclude<TutorialProgress, null> }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const { startTutorial, moveTutorial, exitTutorial } = useWallStore.getState()
  const invite = progress === 'invite'
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }) }, [invite])

  function skip() {
    exitTutorial()
    document.querySelector<HTMLElement>('[data-tour-anchor="add"]')?.focus({ preventScroll: true })
  }

  if (invite) return <section className="onboarding-card wall-tutorial" aria-labelledby="wall-tutorial-title">
    <div className="onboarding-top"><span className="walkthrough-mark"><Compass size={17} /></span><IconButton label="Skip walkthrough" onClick={skip}><X size={16} /></IconButton></div>
    <h2 id="wall-tutorial-title" ref={heading} tabIndex={-1}>Take a quick tour</h2>
    <p>Try the wall controls as you go. You can return to the tour from Help.</p>
    <div className="onboarding-actions">
      <button type="button" className="primary-button" onClick={startTutorial}>Start tour <ArrowRight size={15} /></button>
      <button type="button" className="text-button" onClick={skip}>Skip</button>
    </div>
  </section>

  const step = TUTORIAL_STEPS[progress]
  const StepIcon = icons[step.target]
  const last = progress === TUTORIAL_STEPS.length - 1
  return <section className="onboarding-card wall-tutorial" aria-labelledby="wall-tutorial-title">
    <div className="onboarding-top">
      <span className="walkthrough-label"><span className="walkthrough-mark"><StepIcon size={17} /></span> Step {progress + 1} of {TUTORIAL_STEPS.length}</span>
      <IconButton label="Exit walkthrough" onClick={skip}><X size={16} /></IconButton>
    </div>
    <div aria-live="polite">
      <h2 id="wall-tutorial-title" ref={heading} tabIndex={-1}>{step.title}</h2>
      <p>{step.description}</p>
    </div>
    <div className="walkthrough-controls">
      <button type="button" className="text-button" disabled={progress === 0} onClick={() => moveTutorial(-1)}><ArrowLeft size={14} /> Back</button>
      <button type="button" className="text-button" onClick={skip}>Skip tour</button>
      <button type="button" className="primary-button" onClick={() => {
        moveTutorial(1)
        if (last) document.querySelector<HTMLElement>('[data-tour-anchor="add"]')?.focus({ preventScroll: true })
      }}>{last ? <>Finish <Check size={15} /></> : <>Next <ArrowRight size={15} /></>}</button>
    </div>
  </section>
}
