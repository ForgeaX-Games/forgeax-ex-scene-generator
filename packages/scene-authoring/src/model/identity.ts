export function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  }
  return hash.toString(16).padStart(16, '0')
}

export function stableEntityId(prefix: string, material: string): string {
  return `${prefix}_${stableHash(material).slice(0, 12)}`
}

/**
 * Public Authoring Entity id is the statement id (`@scene-id`).
 * The canvas node id, the kernel node id, and the source anchor are the same
 * string for host calls. Nested helper identities still use `stableEntityId`.
 */
export function publicEntityId(statementId: string): string {
  return statementId
}

