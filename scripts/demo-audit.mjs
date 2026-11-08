import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../lib/store/sqlite.js'

const dir = mkdtempSync(join(tmpdir(), 'caml-demo-'))
const store = await openStore(join(dir, 'caml.db'))

const at = (iso) => Date.parse(iso)

await store.remember({ subject: '支付项目', predicate: '负责人', object: '张三', observedAt: at('2026-09-01T00:00:00Z') })
await store.remember({ subject: '支付项目', predicate: '负责人', object: '李四', observedAt: at('2026-10-15T00:00:00Z') })
await store.remember({ subject: '支付项目', predicate: '负责人', object: '王五', observedAt: at('2026-11-08T00:00:00Z') })

const recalled = await store.recall({ subject: '支付项目', predicate: '负责人' })
const audit = await store.audit('支付项目', '负责人')

console.log(JSON.stringify({
  recall: recalled.facts.map((fact) => fact.object),
  versions: audit.summary.versions,
  statuses: audit.timeline.map((entry) => entry.fact.status),
  adjudications: audit.adjudications.length,
  timeline: audit.timeline.map((entry) => ({
    object: entry.fact.object,
    status: entry.fact.status,
    relation: entry.relation,
    adjudicationId: entry.adjudicationId,
  })),
}, null, 2))

await store.close()
