import { CamlError } from '../errors.js'
import type { AdjudicationPlan, Fact, NewFactInput, Strategy } from './types.js'

export interface PlanInput {
  current: Fact[]
  incoming: Pick<NewFactInput, 'subject' | 'predicate' | 'object' | 'observedAt' | 'sourceSession' | 'metadata'>
  strategy: Strategy
  now: number
  newFactId: string
  newAdjudicationId: string
}

/**
 * Pure adjudication: decide the state transition, do not execute it.
 * The store applies the returned plan inside one transaction.
 */
export function planAdjudication(input: PlanInput): AdjudicationPlan {
  const { current, incoming, strategy, now, newFactId, newAdjudicationId } = input

  if (strategy === 'weighted_decay') {
    throw new CamlError('ERR-INT-001', '加权衰减尚未实现（T3.2）')
  }
  if (strategy !== 'supersede' && strategy !== 'versioned_transfer') {
    throw new CamlError('ERR-CONF-003', `未知策略：${String(strategy)}`)
  }

  const relationType = strategy === 'supersede' ? 'SUPERSEDES' : 'TRANSFERS_TO'

  const insert: Fact = {
    id: newFactId,
    subject: incoming.subject,
    predicate: incoming.predicate,
    object: incoming.object,
    status: 'active',
    weight: 1,
    validFrom: incoming.observedAt,
    validUntil: null,
    supersededBy: null,
    createdAt: now,
    sourceSession: incoming.sourceSession ?? null,
    metadata: incoming.metadata ?? null,
  }

  return {
    insert,
    close: current.map((fact) => ({
      id: fact.id,
      validUntil: incoming.observedAt,
      status: 'superseded' as const,
      supersededBy: newFactId,
    })),
    relations: current.map((fact) => ({
      fromFactId: newFactId,
      toFactId: fact.id,
      relationType,
    })),
    log: {
      id: newAdjudicationId,
      subject: incoming.subject,
      predicate: incoming.predicate,
      conflictFactIds: current.map((fact) => fact.id),
      chosenStrategy: strategy,
      resultFactId: newFactId,
      reason: 'new_value',
      createdAt: now,
    },
  }
}
