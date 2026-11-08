import { renderAudit, toFactView } from './render.js'
import type { ToolRegistration } from './register.js'
import { assertAuditLimit } from './common.js'
import { assertPredicate, assertSubject } from '../domain/validate.js'
import type { FactStore } from '../store/port.js'

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString())

export function makeAuditTool(store: FactStore): ToolRegistration {
  return {
    name: 'caml-audit',
    description: '只读。一次调用返回某 (subject, predicate) 的完整版本时间线（含已取代的旧值）、裁决记录与当前值，足以回答"以前/之前是什么"。不要重复调用；键请从 caml-recall 的结果里取。',
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
      const subject = assertSubject(input.subject)
      const predicate = assertPredicate(input.predicate)
      const limit = assertAuditLimit(input.limit)

      const audit = await store.audit(subject, predicate, limit)
      return {
        subject: audit.subject,
        predicate: audit.predicate,
        summary: {
          current: audit.summary.current === null ? null : toFactView(audit.summary.current),
          versions: audit.summary.versions,
          firstAt: iso(audit.summary.firstAt),
          lastAt: iso(audit.summary.lastAt),
        },
        timeline: audit.timeline.map((entry) => ({
          ...toFactView(entry.fact),
          relation: entry.relation,
          adjudicationId: entry.adjudicationId,
        })),
        adjudications: audit.adjudications.map((entry) => ({
          id: entry.id,
          at: iso(entry.at),
          strategy: entry.strategy,
          previousIds: entry.previousIds,
          resultFactId: entry.resultFactId,
          reason: entry.reason,
        })),
        truncated: audit.truncated,
      }
    },
  }
}
