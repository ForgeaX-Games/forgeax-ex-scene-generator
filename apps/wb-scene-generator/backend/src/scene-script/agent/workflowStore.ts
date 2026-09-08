import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  SCENE_WORKFLOW_LIMITS,
  SCENE_WORKFLOW_VERSION,
  stableArtifactStringify,
  type SceneEditTransaction,
  type SceneSemanticDiff,
  type SceneVerification,
  type SceneWorkArtifactRefs,
  type SceneWorkGraph,
  type SceneWorkNode,
} from '@forgeax/scene-authoring'

export interface StoredSceneTransaction {
  transaction: SceneEditTransaction
  status: SceneWorkNode['status']
  beforeSources: Record<string, string>
  afterSources?: Record<string, string>
  diff?: SceneSemanticDiff
  verification?: SceneVerification
  undoToken?: string
  retries: number
  createdAt: string
  updatedAt: string
}

function root(projectDir: string): string {
  return resolve(projectDir, 'artifacts', 'scene-agent')
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`invalid workflow id: ${value}`)
  return value
}

function nodeRoot(projectDir: string, id: string): string {
  return resolve(root(projectDir), 'work', safeId(id))
}

function transactionFile(projectDir: string, id: string): string {
  return resolve(root(projectDir), 'transactions', `${safeId(id)}.json`)
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${stableArtifactStringify(value)}\n`, 'utf8')
  await rename(temporary, path)
}

export function workArtifactRefs(workNodeId: string): SceneWorkArtifactRefs {
  const prefix = `artifacts/scene-agent/work/${workNodeId}`
  return {
    workOrder: `${prefix}/work-order.json`,
    result: `${prefix}/result.json`,
    astPatch: `${prefix}/ast-patch.json`,
    semanticDiff: `${prefix}/semantic-diff.json`,
    verification: `${prefix}/verification.json`,
    progress: `${prefix}/progress.json`,
    checkpoint: `${prefix}/checkpoint.json`,
  }
}

export async function writeWorkNodeArtifacts(
  projectDir: string,
  node: SceneWorkNode,
  artifacts: {
    workOrder?: unknown
    result?: unknown
    astPatch?: unknown
    semanticDiff?: unknown
    verification?: unknown
    progress?: unknown
    checkpoint?: unknown
  },
): Promise<void> {
  const base = nodeRoot(projectDir, node.id)
  await Promise.all([
    atomicJson(resolve(base, 'node.json'), node),
    ...Object.entries(artifacts).map(([name, value]) =>
      atomicJson(resolve(base, `${name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}.json`), value)),
  ])
}

export async function readWorkNodes(projectDir: string): Promise<SceneWorkNode[]> {
  const base = resolve(root(projectDir), 'work')
  const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
  const nodes = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {
      return JSON.parse(await readFile(resolve(base, entry.name, 'node.json'), 'utf8')) as SceneWorkNode
    } catch {
      return null
    }
  }))
  return nodes
    .filter((node): node is SceneWorkNode => node !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 50)
}

export async function readWorkGraph(projectDir: string, projectId: string): Promise<SceneWorkGraph> {
  const nodes = await readWorkNodes(projectDir)
  return {
    version: SCENE_WORKFLOW_VERSION,
    projectId,
    nodes,
    ...(nodes.find((node) => !['accepted', 'reverted', 'failed'].includes(node.status))
      ? { activeTransactionId: nodes.find((node) => !['accepted', 'reverted', 'failed'].includes(node.status))!.id }
      : {}),
    payload: 'bounded-work-overlay',
  }
}

export async function writeStoredTransaction(projectDir: string, value: StoredSceneTransaction): Promise<void> {
  await atomicJson(transactionFile(projectDir, value.transaction.transactionId), value)
}

export async function readStoredTransaction(projectDir: string, id: string): Promise<StoredSceneTransaction | null> {
  try {
    return JSON.parse(await readFile(transactionFile(projectDir, id), 'utf8')) as StoredSceneTransaction
  } catch {
    return null
  }
}

export function newWorkNode(
  id: string,
  targetIds: string[],
  scope: string[],
  humanGate?: SceneEditTransaction['humanGate'],
  retries = 0,
): SceneWorkNode {
  return {
    id,
    kind: 'module-editor-agent',
    status: humanGate?.required ? 'blocked' : 'planned',
    targetIds: targetIds.slice(0, SCENE_WORKFLOW_LIMITS.maxTargets),
    scope: scope.slice(0, SCENE_WORKFLOW_LIMITS.maxTargets),
    artifacts: workArtifactRefs(id),
    diagnostics: [],
    ...(humanGate ? { humanGate } : {}),
    budget: {
      maxCommands: SCENE_WORKFLOW_LIMITS.maxCommands,
      maxTargets: SCENE_WORKFLOW_LIMITS.maxTargets,
      retries,
      maxRetries: SCENE_WORKFLOW_LIMITS.maxRetries,
      stopped: false,
      circuitOpen: false,
    },
    updatedAt: new Date().toISOString(),
  }
}
