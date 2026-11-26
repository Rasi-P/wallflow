import { useSyncExternalStore } from 'react'

export const STUDY_PHONE_MEDIA = '(max-width: 560px) and (orientation: portrait)'

function subscribe(update: () => void) {
  const query = window.matchMedia(STUDY_PHONE_MEDIA)
  query.addEventListener('change', update)
  return () => query.removeEventListener('change', update)
}

export function useStudyPhone() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(STUDY_PHONE_MEDIA).matches, () => false)
}
