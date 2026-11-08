import { CamlError } from '../errors.js'
import type { AdjudicationPlan, Fact, NewFactInput, Strategy } from './types.js'

export interface PlanInput {
  current: Fact[]
  incoming: Pick<NewFactInput, 'subject' | 'predicate' | 'object' | 'observedAt' | 'sourceSession' | 'metadata'>
  strategy: Strategy
  now: number
  newFactId: string
  newAdjudicationId: string
  decayFactor?: number
}

const roundWeight = (value: number): number => Math.round(value * 10_000) / 10_000

/**
 * Pure adjudication: decide the state transition, do not execute it.
 * The store applies the returned plan inside one transaction.
 */
export function planAdjudication(input: PlanInput): AdjudicationPlan {
  const { current, incoming, strategy, now, newFactId, newAdjudicationId } = input

  if (strategy !== 'supersede' && strategy !== 'versioned_transfer' && strategy !== 'weighted_decay') {
    throw new CamlError('ERR-CONF-003', `未知策略：${String(strategy)}`)
  }

  const relationType = strategy === 'weighted_decay'
    ? 'DECAYS_FROM'
    : (strategy === 'supersede' ? 'SUPERSEDES' : 'TRANSFERS_TO')

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

  const log = {
    id: newAdjudicationId,
    subject: incoming.subject,
    predicate: incoming.predicate,
    conflictFactIds: current.map((fact) => fact.id),
    chosenStrategy: strategy,
    resultFactId: newFactId,
    reason: strategy === 'weighted_decay' ? 'preference_drift' : 'new_value',
    createdAt: now,
  }

  if (strategy === 'weighted_decay') {
    const factor = input.decayFactor ?? 0.5
    return {
      insert,
      close: [],
      decay: current.map((fact) => ({
        id: fact.id,
        weight: roundWeight(fact.weight * factor),
        status: 'decayed' as const,
      })),
      relations: current.map((fact) => ({
        fromFactId: newFactId,
        toFactId: fact.id,
        relationType,
      })),
      log,
    }
  }

  return {
    insert,
    close: current.map((fact) => ({
      id: fact.id,
      validUntil: incoming.observedAt,
      status: 'superseded' as const,
      supersededBy: newFactId,
    })),
    decay: [],
    relations: current.map((fact) => ({
      fromFactId: newFactId,
      toFactId: fact.id,
      relationType,
    })),
    log,
  }
}
