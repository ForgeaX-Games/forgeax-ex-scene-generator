export type DomainPackId = 'scene'
export type DomainPackStatus = 'active' | 'error'

export interface DomainPackInfo {
  id: DomainPackId
  kind: DomainPackId
  status: DomainPackStatus
  label: string
  diagnostic?: string
  batteryCount?: number
  modes?: readonly string[]
}
