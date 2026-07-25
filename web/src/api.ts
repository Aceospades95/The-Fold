import { useCallback, useEffect, useRef, useState } from 'react'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
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
  return { data, error, loading, reload: load }
}
