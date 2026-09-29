import { useEffect, useState } from 'react'
import type { HttpApiClient } from '../api/HttpApiClient.js'

export type SceneProjectInfo = Awaited<ReturnType<HttpApiClient['getSceneScriptProjectInfo']>>

export function useSceneProjectInfo(client: HttpApiClient | undefined, projectId: string | null) {
  const [info, setInfo] = useState<SceneProjectInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    setInfo(null)
    setError(null)
    setLoading(Boolean(client && projectId))
    if (!client || !projectId) return

    let disposed = false
    let requestSequence = 0
    const refresh = async () => {
      const sequence = ++requestSequence
      try {
        const next = await client.getSceneScriptProjectInfo(projectId)
        if (disposed || sequence !== requestSequence) return
        setInfo(next)
        setError(null)
      } catch (reason: unknown) {
        if (disposed || sequence !== requestSequence) return
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (!disposed && sequence === requestSequence) setLoading(false)
      }
    }
    const unsubscribe = client.subscribeRaw('scene:project-changed', payload => {
      if (payload && typeof payload === 'object' && 'projectId' in payload && payload.projectId === projectId) {
        void refresh()
      }
    })
    void refresh()
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [client, projectId, retry])

  return { info, error, loading, retry: () => setRetry(value => value + 1) }
}
