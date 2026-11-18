import type { CamlConfig } from '../config.js'
import type { FactStore } from '../store/port.js'
import { assertLimit, optionalIso, optionalMinWeight, optionalQuery, optionalString } from './common.js'
import { assertObject } from '../domain/validate.js'
import { renderRecall, toFactView } from './render.js'
import type { ToolRegistration } from './register.js'

export function makeRecallTool(store: FactStore, config: CamlConfig): ToolRegistration {
  return {
    name: 'caml-recall',
    description: '只读。用户提到或确认某个记忆细节（如"我记得是…"）时，先用 object=<值> + includeHistory=true 反查，返回该坐标的全部版本（带 status）；按坐标问"现在"用 subject/predicate；问"以前/之前"用 caml-audit。includeHistory 默认 false，不得用于默认召回。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string' },
        predicate: { type: 'string' },
        query: { type: 'string' },
        object: { type: 'string' },
        includeHistory: { type: 'boolean' },
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
      const includeHistory = input.includeHistory === true
      const object = input.object === undefined ? undefined : assertObject(input.object)
      const result = await store.recall({
        subject: optionalString(input.subject),
        predicate: optionalString(input.predicate),
        query: optionalQuery(input.query),
        object,
        includeHistory,
        includeDecayed: input.includeDecayed === true,
        minWeight: minWeight
          ?? (asOf === undefined && !includeHistory ? config.strategies.minWeight : undefined),
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
