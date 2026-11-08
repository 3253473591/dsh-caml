/** Fact, strategy and relation types shared by domain, store and tools. */

export type Strategy = 'supersede' | 'versioned_transfer' | 'weighted_decay'

export type FactStatus = 'active' | 'superseded' | 'decayed'

export type RelationType = 'SUPERSEDES' | 'TRANSFERS_TO' | 'DECAYS_FROM'

export interface Fact {
  id: string
  subject: string
  predicate: string
  object: string
  status: FactStatus
  weight: number
  /** epoch ms, UTC */
  validFrom: number
  /** epoch ms, UTC; null means still true */
  validUntil: number | null
  supersededBy: string | null
  /** epoch ms, UTC (transaction time) */
  createdAt: number
  sourceSession: string | null
  metadata: Record<string, unknown> | null
}

export interface NewFactInput {
  subject: string
  predicate: string
  object: string
  observedAt: number
  sourceSession?: string | null
  metadata?: Record<string, unknown> | null
}
