import { renderAudit } from './render.js'
import type { ToolRegistration } from './register.js'

/**
 * Read-only audit surface. T1 registers the empty-coordinate contract;
 * T2.3 replaces the body with the real timeline query.
 */
export function makeAuditTool(): ToolRegistration {
  return {
    name: 'caml-audit',
    description: '只读。返回某 (subject, predicate) 的完整版本时间线与裁决记录。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'predicate'],
      properties: {
        subject: { type: 'string' },
        predicate: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
    output: { schema: { type: 'object' }, render: renderAudit },
    execute: async (args: unknown) => {
      const input = args as Record<string, unknown>
      return {
        subject: input.subject,
        predicate: input.predicate,
        summary: { current: null, versions: 0, firstAt: null, lastAt: null },
        timeline: [],
        adjudications: [],
        truncated: { timeline: false, adjudications: false },
      }
    },
  }
}
