const API = '/api/v1/auth'

export const GOOGLE_START = `${API}/google/start/`

export interface Account {
  id: string
  displayName: string | null
  email: string | null
}

class AuthApiError extends Error {
  readonly code: string | undefined

  constructor(code?: string) {
    super('The authentication service could not complete this request.')
    this.code = code
  }
}

async function readObject(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new AuthApiError()
  return body as Record<string, unknown>
}

function isProfileField(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function createAuthApi(fetcher: typeof fetch = fetch) {
  const request = (path: string, options?: RequestInit) => fetcher(`${API}${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    ...options,
    headers: { Accept: 'application/json', ...options?.headers },
  })

  async function csrfToken() {
    const response = await request('/csrf/')
    if (response.status !== 200) throw new AuthApiError()
    const { csrfToken: token } = await readObject(response)
    if (typeof token !== 'string' || !token) throw new AuthApiError()
    return token
  }

  async function signOutRequest() {
    return request('/logout/', { method: 'POST', headers: { 'X-CSRFToken': await csrfToken() } })
  }

  async function authFailure(response: Response) {
    if (response.status !== 401 && response.status !== 403) return undefined
    const { error } = await readObject(response).catch(() => ({ error: null }))
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  }

  return {
    csrfToken,
    async currentAccount(): Promise<Account | null> {
      const response = await request('/me/')
      if (await authFailure(response) === 'auth_required') return null
      if (response.status !== 200) throw new AuthApiError()
      const { id, displayName, email } = await readObject(response)
      if (typeof id !== 'string' || !id || !isProfileField(displayName) || !isProfileField(email)) throw new AuthApiError()
      return { id, displayName, email }
    },
    async logout() {
      let response = await signOutRequest()
      let code = await authFailure(response)
      if (code === 'csrf_failed') {
        response = await signOutRequest()
        code = await authFailure(response)
      }
      if (response.status === 204 || code === 'auth_required') return
      throw new AuthApiError(code)
    },
  }
}

export function submitGoogleLogin(token: string) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = GOOGLE_START
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'csrfmiddlewaretoken'
  input.value = token
  form.append(input)
  document.body.append(form)
  try {
    form.submit()
  } finally {
    form.remove()
  }
}
