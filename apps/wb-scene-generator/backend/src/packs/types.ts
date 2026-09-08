export type DomainPackId = 'world' | 'geometry' | 'image'
export type DomainPackStatus = 'active' | 'stub' | 'error'

export interface DomainPackInfo {
  id: DomainPackId
  kind: DomainPackId
  status: DomainPackStatus
  label: string
  /** Present for stub / error packs — one sentence the left pane can show on click. */
  diagnostic?: string
  /** Where the pack currently lives while it is a stub. */
  livesIn?: string
  batteryCount?: number
  modes?: readonly string[]
}
