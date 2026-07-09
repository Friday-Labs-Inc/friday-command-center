// Minimal async data hook. No external dependencies.
// useAsync(fn, deps) → { data, loading, error, reload }
//
// - loading starts true on first call and on every reload().
// - Stale responses from in-flight requests that have been superseded are
//   discarded (counter pattern).
// - deps is passed to useCallback so fn is stable across renders; omit deps
//   (pass []) for fetch-once-on-mount behaviour.

import { useState, useEffect, useCallback, useRef } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  reload: () => void
}

export function useAsync<T>(
  fn: () => Promise<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: ReadonlyArray<any>,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const counter = useRef(0)

  const run = useCallback(() => {
    const id = ++counter.current
    setLoading(true)
    setError(null)
    fn()
      .then(d => {
        if (id !== counter.current) return
        setData(d)
        setLoading(false)
      })
      .catch(e => {
        if (id !== counter.current) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { run() }, [run])

  return { data, loading, error, reload: run }
}
