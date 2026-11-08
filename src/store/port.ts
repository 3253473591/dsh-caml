import type { Fact, NewFactInput, RelationType, Strategy } from '../domain/types.js'

export interface AdjudicationSummary {
  id: string
  previous: Array<{ id: string; object: string; weight: number; validFrom: number; validUntil: number }>
  relation: RelationType
}

export interface RememberResult {
  fact: Fact
  action: 'created' | 'duplicate' | 'superseded' | 'transferred' | 'decayed'
  strategy?: Strategy
  adjudication?: AdjudicationSummary
}

export interface RecallQuery {
  subject?: string
  predicate?: string
  query?: string
  includeDecayed?: boolean
  minWeight?: number
  limit?: number
  /** epoch ms; T3.3 wires historical lookups */
  asOf?: number
}

export interface RecallResult {
  facts: Fact[]
  truncated: boolean
}

/** Storage port. The surface grows with the tasks that need it. */
export interface FactStore {
  remember(input: NewFactInput): Promise<RememberResult>
  recall(query?: RecallQuery): Promise<RecallResult>
  current(subject: string, predicate: string): Promise<Fact[]>
  close(): Promise<void>
}
