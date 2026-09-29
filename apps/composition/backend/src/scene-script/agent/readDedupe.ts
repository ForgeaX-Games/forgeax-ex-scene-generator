import { createHash } from 'node:crypto'

export type ReadToolKind = 'list' | 'open' | 'get' | 'contracts'

export const READ_DEDUPE_NEXT_ACTION =
  'Same project revision is already in context. Next step must be scene:authoring.applyCommands, scene:script.commitProject, scene:script.verify, or an explicit blocker — do not list/open/get again.'

const REPEAT_READ_HINT_AFTER = 1

type Caller = {
  kind?: string
  sessionId?: string
  agentId?: string
}

interface ReadFingerprint {
  revision: string | null
  digest: string
  consecutive: number
}

interface SessionReads {
  fingerprints: Map<string, ReadFingerprint>
  consecutiveReadOnly: number
}

const sessions = new Map<string, SessionReads>()

function sessionKey(caller: Caller): string {
  return `${caller.sessionId ?? 'anon'}:${caller.agentId ?? 'agent'}`
}

function ensureSession(caller: Caller): SessionReads {
  const key = sessionKey(caller)
  const existing = sessions.get(key)
  if (existing) return existing
  const created: SessionReads = { fingerprints: new Map(), consecutiveReadOnly: 0 }
  sessions.set(key, created)
  return created
}

function fingerprintKey(
  tool: ReadToolKind,
  projectId: string,
  extra = '',
): string {
  return `${tool}:${projectId}:${extra}`
}

export function hashReadPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)
}

export function resetReadDedupeForTests(): void {
  sessions.clear()
}

export function noteAuthoringMutation(caller: Caller, projectId?: string): void {
  const session = ensureSession(caller)
  session.consecutiveReadOnly = 0
  if (!projectId) {
    session.fingerprints.clear()
    return
  }
  for (const key of [...session.fingerprints.keys()]) {
    if (key.includes(`:${projectId}:`) || key.endsWith(`:${projectId}:`)) {
      session.fingerprints.delete(key)
    }
  }
}

export function dedupeRead(input: {
  caller: Caller
  tool: ReadToolKind
  projectId?: string
  revision?: string | null
  extra?: string
  payload: unknown
  force?: boolean
}): { delivered: unknown; unchanged: boolean; consecutiveReadOnly: number } {
  const projectId = input.projectId?.trim() || '*'
  const digest = hashReadPayload(input.payload)
  const session = ensureSession(input.caller)
  const key = fingerprintKey(input.tool, projectId, input.extra ?? '')
  const previous = session.fingerprints.get(key)
  const sameRevision = previous
    && previous.revision === (input.revision ?? null)
    && previous.digest === digest
  if (!input.force && sameRevision && previous) {
    previous.consecutive += 1
    session.consecutiveReadOnly += 1
    const consecutive = previous.consecutive
    return {
      delivered: {
        unchanged: true,
        projectId: projectId === '*' ? undefined : projectId,
        projectRevision: input.revision ?? undefined,
        tool: `scene:${input.tool === 'list' || input.tool === 'open' ? 'projects' : 'script'}.${input.tool === 'get' ? 'get' : input.tool}`,
        hint: 'Same project revision; compact context was already delivered.',
        consecutiveReads: consecutive,
        nextAction: consecutive >= REPEAT_READ_HINT_AFTER || session.consecutiveReadOnly >= 3
          ? READ_DEDUPE_NEXT_ACTION
          : 'Pass ifRevision on the next get, or continue with a mutation / verify.',
        payload: 'compact-read-unchanged',
      },
      unchanged: true,
      consecutiveReadOnly: session.consecutiveReadOnly,
    }
  }

  session.fingerprints.set(key, {
    revision: input.revision ?? null,
    digest,
    consecutive: 0,
  })
  session.consecutiveReadOnly += 1
  const delivered = session.consecutiveReadOnly >= 3 && input.payload && typeof input.payload === 'object'
    ? {
        ...(input.payload as Record<string, unknown>),
        nextAction: READ_DEDUPE_NEXT_ACTION,
      }
    : input.payload
  return {
    delivered,
    unchanged: false,
    consecutiveReadOnly: session.consecutiveReadOnly,
  }
}
