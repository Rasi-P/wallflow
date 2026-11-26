import { create } from 'zustand'

const keys = { office: 'wallflow-office-motion', study: 'wallflow-study-motion' }
export type MotionRoom = keyof typeof keys

function readPreference(room: MotionRoom) {
  try { return globalThis.localStorage?.getItem(keys[room]) !== 'paused' } catch { return true }
}

export const useEnvironmentMotionStore = create<Record<MotionRoom, boolean> & {
  setEnabled: (room: MotionRoom, enabled: boolean) => void
}>((set) => ({
  office: readPreference('office'),
  study: readPreference('study'),
  setEnabled(room, enabled) {
    set({ [room]: enabled })
    try { globalThis.localStorage?.setItem(keys[room], enabled ? 'enabled' : 'paused') } catch {
      // The switch still works for the current session when storage is unavailable.
    }
  },
}))
