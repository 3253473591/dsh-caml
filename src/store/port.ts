import type { Fact, NewFactInput } from '../domain/types.js'

export interface RememberResult {
  fact: Fact
  action: 'created' | 'duplicate'
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
