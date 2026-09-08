import { createHash } from 'node:crypto'

export function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function stableJsonHash(value: unknown): string {
  return contentHash(JSON.stringify(value))
}
