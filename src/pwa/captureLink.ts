const capturePaths = new Set(['/capture', '/capture/native/android', '/capture/native/ios'])
const intentKey = 'wallflow:quick-capture'

export function isCaptureLink(url: URL) {
  return capturePaths.has(url.pathname) && !url.search && !url.hash
}

export function captureLinkPending() {
  if (isCaptureLink(new URL(location.href))) return true
  try { return sessionStorage.getItem(intentKey) === '1' } catch { return false }
}

export function rememberCaptureLink() {
  if (!isCaptureLink(new URL(location.href))) return
  try { sessionStorage.setItem(intentKey, '1') } catch { /* Sign-in still works if storage is unavailable. */ }
}

export function consumeCaptureLink() {
  try { sessionStorage.removeItem(intentKey) } catch { /* Ignore unavailable storage. */ }
  if (isCaptureLink(new URL(location.href))) history.replaceState(null, '', '/app/')
}
