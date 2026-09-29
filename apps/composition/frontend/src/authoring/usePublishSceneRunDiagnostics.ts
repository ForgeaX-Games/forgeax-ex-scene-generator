import { useEffect } from 'react'
import { useProjectStore } from '@forgeax/node-runtime-react/editor'

import {
  HttpApiRequestError,
  type HttpApiClient,
  type SceneResultLineage,
  type SceneScriptDiagnostic,
} from '../api/HttpApiClient.js'
import { publishSceneScriptDiagnostics } from './sceneScriptDiagnosticBridge.js'

type DiagnosticPayload = {
  diagnostics?: SceneScriptDiagnostic[]
  lineage?: SceneResultLineage[]
}

function publish(
  projectId: string | null | undefined,
  payload: DiagnosticPayload,
  opts: { clearWhenMissing: boolean },
): void {
  if (!projectId) return
  if (!opts.clearWhenMissing && !payload.diagnostics) return
  publishSceneScriptDiagnostics(projectId, payload.diagnostics ?? [], [], payload.lineage ?? [])
}

function publishFromError(error: unknown): void {
  if (!(error instanceof HttpApiRequestError) || !error.payload) return
  const payload = error.payload as DiagnosticPayload
  if (!payload.diagnostics) return
  publish(useProjectStore.getState().viewingProjectId, payload, { clearWhenMissing: false })
}

/** Canvas drop / execute should paint diagnostics even when the Code dock is closed. */
export function usePublishSceneRunDiagnostics(client: HttpApiClient): void {
  useEffect(() => {
    const originalExecute = client.execute.bind(client)
    const originalApplyBatch = client.applyBatch.bind(client)

    client.execute = async (request) => {
      try {
        const result = await originalExecute(request)
        publish(useProjectStore.getState().viewingProjectId, result as DiagnosticPayload, { clearWhenMissing: true })
        return result
      } catch (error) {
        publishFromError(error)
        throw error
      }
    }
    client.applyBatch = async (ops, opts) => {
      try {
        const result = await originalApplyBatch(ops, opts)
        publish(useProjectStore.getState().viewingProjectId, result as DiagnosticPayload, { clearWhenMissing: false })
        return result
      } catch (error) {
        publishFromError(error)
        throw error
      }
    }

    return () => {
      client.execute = originalExecute
      client.applyBatch = originalApplyBatch
    }
  }, [client])
}
