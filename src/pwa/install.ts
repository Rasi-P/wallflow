type InstallPrompt = Event & {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const display = matchMedia('(display-mode: standalone)')
const listeners = new Set<() => void>()
let prompt: InstallPrompt | undefined
let installed = display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
const publish = () => listeners.forEach((notify) => notify())

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  prompt = event as InstallPrompt
  publish()
})
window.addEventListener('appinstalled', () => {
  installed = true
  prompt = undefined
  publish()
})
display.addEventListener('change', () => {
  installed = display.matches
  publish()
})

export function subscribeInstall(notify: () => void) {
  listeners.add(notify)
  return () => { listeners.delete(notify) }
}

export function installState() { return installed ? 'installed' : prompt ? 'prompt' : 'manual' }

export async function requestInstall() {
  const event = prompt
  if (!event) return
  prompt = undefined
  publish()
  await event.prompt()
}
