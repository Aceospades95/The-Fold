import { useCallback, useEffect, useRef, useState } from 'react'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Connection state the whole app can watch: the server being down (restart,
 * network blip) shows one banner instead of every page silently going blank,
 * and an expired session bounces to the login screen instead of a dead UI.
 */
type ConnectionListener = (state: { offline: boolean; unauthorized: boolean }) => void
const listeners = new Set<ConnectionListener>()
let offline = false

function notify(state: { offline: boolean; unauthorized: boolean }): void {
  for (const listener of listeners) listener(state)
}

export function onConnectionChange(listener: ConnectionListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    if (!offline) {
      offline = true
      notify({ offline: true, unauthorized: false })
    }
    throw new ApiError(0, 'Can’t reach the server')
  }
  if (offline) {
    offline = false
    notify({ offline: false, unauthorized: false })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && path !== '/bootstrap' && !path.startsWith('/auth/')) {
      notify({ offline: false, unauthorized: true })
    }
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

/** Fetch JSON from the API and re-fetch when `path` changes; call reload() after mutations. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const generation = useRef(0)

  const load = useCallback(() => {
    if (path === null) return
    const gen = ++generation.current
    setLoading(true)
    api
      .get<T>(path)
      .then((result) => {
        if (generation.current === gen) {
          setData(result)
          setError(null)
        }
      })
      .catch((err: Error) => {
        if (generation.current === gen) setError(err.message)
      })
      .finally(() => {
        if (generation.current === gen) setLoading(false)
      })
  }, [path])

  useEffect(load, [load])

  // When the server comes back from a restart, refetch instead of staying stale.
  useEffect(() => {
    return onConnectionChange((state) => {
      if (!state.offline && !state.unauthorized && error) load()
    })
  }, [error, load])

  return { data, error, loading, reload: load }
}
