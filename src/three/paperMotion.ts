import { DRAG_NOTE_DEPTH } from './noteLayers.ts'

export type PaperMotionFrame = (delta: number) => boolean
export const CONTACT_SHADOW_OPACITY = 0.82

export function getPickupLift(depth: number) {
  return Math.max(DRAG_NOTE_DEPTH - depth, 0.062)
}

export function stepPaperLift(lift: number, target: number, delta: number, reducedMotion: boolean) {
  const rate = target > lift ? 28 : 17
  const next = lift + (target - lift) * (1 - Math.exp(-rate * Math.min(delta, 0.05)))
  return reducedMotion || Math.abs(target - next) < 0.001 ? target : next
}
