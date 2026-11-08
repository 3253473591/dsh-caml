import type { CamlConfig } from '../config.js'
import type { FactStore } from '../store/port.js'
import { assertLimit, optionalIso, optionalMinWeight, optionalQuery, optionalString } from './common.js'
import { renderRecall, toFactView } from './render.js'
import type { ToolRegistration } from './register.js'

export function makeRecallTool(store: FactStore, config: CamlConfig): ToolRegistration {
  return {
    name: 'caml-recall',
    description: '只读。返回默认召回集合（当前有效事实），支持 asOf 历史查询。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string' },
        predicate: { type: 'string' },
        query: { type: 'string' },
        asOf: { type: 'string' },
        includeDecayed: { type: 'boolean' },
        minWeight: { type: 'number' },
        limit: { type: 'integer' },
      },
    },
    output: { schema: { type: 'object' }, render: renderRecall },
    execute: async (args: unknown) => {
      const input = args as Record<string, unknown>
      const asOf = optionalIso(input.asOf, 'asOf')
      const minWeight = optionalMinWeight(input.minWeight)
      const result = await store.recall({
        subject: optionalString(input.subject),
        predicate: optionalString(input.predicate),
        query: optionalQuery(input.query),
        includeDecayed: input.includeDecayed === true,
        minWeight: minWeight ?? (asOf === undefined ? config.strategies.minWeight : undefined),
        limit: assertLimit(input.limit),
        asOf,
      })
      return {
        facts: result.facts.map(toFactView),
        count: result.facts.length,
        truncated: result.truncated,
        asOf: asOf === undefined ? null : new Date(asOf).toISOString(),
      }
    },
  }
}
