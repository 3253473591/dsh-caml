import type { CamlConfig } from '../config.js'
import type { FactStore } from '../store/port.js'
import { assertStrategy, parseIso } from './common.js'
import { renderRemember, toFactView } from './render.js'
import type { ToolRegistration } from './register.js'
import { assertPredicate } from '../domain/validate.js'

export function makeRememberTool(store: FactStore, config: CamlConfig): ToolRegistration {
  return {
    name: 'caml-remember',
    description: '写入一条记忆事实；同一 (subject, predicate) 出现冲突时按策略裁决。会改变记忆状态。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'predicate', 'object'],
      properties: {
        subject: { type: 'string' },
        predicate: { type: 'string' },
        object: { type: 'string' },
        observedAt: { type: 'string' },
        metadata: { type: 'object' },
        sourceSession: { type: 'string' },
        strategy: { type: 'string', enum: ['supersede', 'versioned_transfer', 'weighted_decay'] },
      },
    },
    output: { schema: { type: 'object' }, render: renderRemember },
    execute: async (args: unknown) => {
      const input = args as Record<string, unknown>
      const observedAt = input.observedAt === undefined ? Date.now() : parseIso(input.observedAt, 'observedAt')
      const predicate = assertPredicate(input.predicate)
      const explicit = input.strategy === undefined ? undefined : assertStrategy(input.strategy)
      const strategy = explicit ?? config.strategies.byPredicate[predicate] ?? config.strategies.default
      const result = await store.remember({
        subject: input.subject as string,
        predicate,
        object: input.object as string,
        observedAt,
        sourceSession: typeof input.sourceSession === 'string' ? input.sourceSession : null,
        metadata: (input.metadata ?? null) as Record<string, unknown> | null,
        strategy,
        decayFactor: config.strategies.decayFactor,
      })
      return {
        fact: toFactView(result.fact),
        action: result.action,
        strategy: result.strategy ?? null,
        adjudication: result.adjudication ?? null,
      }
    },
  }
}
