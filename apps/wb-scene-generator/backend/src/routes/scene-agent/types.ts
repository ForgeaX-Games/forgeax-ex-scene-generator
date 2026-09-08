export const SCENE_AGENT_PREFIX = '/api/v1/projects/:projectId/scene-agent'

export interface ProjectParams { projectId: string }
export interface TransactionParams extends ProjectParams { transactionId: string }
