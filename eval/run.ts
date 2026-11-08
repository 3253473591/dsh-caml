import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../src/store/sqlite.js'
import type { Strategy } from '../src/domain/types.js'

interface Case {
  id: string
  strategy: Strategy
  given: Array<{ subject: string; predicate: string; object: string; observedAt: string }>
  when: { subject: string; predicate: string; object: string; observedAt: string; strategy?: Strategy }
  expect: {
    action: string
    relation: string
    recallDefault: string[]
    recallAsOf?: Record<string, string[]>
    auditVersions: number
    auditCurrent: string
    statuses: string[]
    weights?: Record<string, number>
  }
}

const all = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as Case[]

const onlyArg = process.argv.find((arg) => arg.startsWith('--only'))
const only = onlyArg?.split('=')[1]?.split(',') ?? []
const cases = only.length === 0 ? all : all.filter((entry) => only.some((prefix) => entry.id.includes(`-${prefix}-`)))

const sameSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && [...left].sort().join('|') === [...right].sort().join('|')

const results: Array<{ id: string; pass: boolean; checks: string[] }> = []

for (const testCase of cases) {
  const dir = await mkdtemp(join(tmpdir(), 'caml-eval-'))
  const store = await openStore(join(dir, 'caml.db'))
  const checks: string[] = []
  const fail = (message: string): void => { checks.push(message) }

  try {
    for (const fact of testCase.given) {
      await store.remember({
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        observedAt: Date.parse(fact.observedAt),
        strategy: testCase.strategy,
      })
    }

    const when = testCase.when
    const result = await store.remember({
      subject: when.subject,
      predicate: when.predicate,
      object: when.object,
      observedAt: Date.parse(when.observedAt),
      strategy: when.strategy ?? testCase.strategy,
    })

    if (result.action !== testCase.expect.action) fail(`action=${result.action} want=${testCase.expect.action}`)
    if (result.adjudication?.relation !== testCase.expect.relation) {
      fail(`relation=${String(result.adjudication?.relation)} want=${testCase.expect.relation}`)
    }

    const recalled = await store.recall({ subject: when.subject, predicate: when.predicate })
    if (!sameSet(recalled.facts.map((fact) => fact.object), testCase.expect.recallDefault)) {
      fail(`recall=${recalled.facts.map((fact) => fact.object).join(',')}`)
    }

    for (const [asOf, expected] of Object.entries(testCase.expect.recallAsOf ?? {})) {
      const historical = await store.recall({
        subject: when.subject,
        predicate: when.predicate,
        asOf: Date.parse(asOf),
      })
      if (!sameSet(historical.facts.map((fact) => fact.object), expected)) {
        fail(`asOf(${asOf})=${historical.facts.map((fact) => fact.object).join(',')}`)
      }
    }

    const audit = await store.audit(when.subject, when.predicate)
    if (audit.summary.versions !== testCase.expect.auditVersions) {
      fail(`versions=${audit.summary.versions} want=${testCase.expect.auditVersions}`)
    }
    if (audit.summary.current?.object !== testCase.expect.auditCurrent) {
      fail(`current=${String(audit.summary.current?.object)} want=${testCase.expect.auditCurrent}`)
    }
    if (!sameSet(audit.timeline.map((entry) => entry.fact.status), testCase.expect.statuses)) {
      fail(`statuses=${audit.timeline.map((entry) => entry.fact.status).join(',')}`)
    }

    for (const [object, weight] of Object.entries(testCase.expect.weights ?? {})) {
      const found = (await store.recall({ subject: when.subject, predicate: when.predicate, includeDecayed: true }))
        .facts.find((fact) => fact.object === object)
      if (found === undefined || Math.abs(found.weight - weight) > 1e-9) {
        fail(`weight(${object})=${String(found?.weight)} want=${weight}`)
      }
    }
  } catch (error) {
    fail(`threw ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }

  results.push({ id: testCase.id, pass: checks.length === 0, checks })
}

const passed = results.filter((entry) => entry.pass).length
const report = { total: results.length, passed, failed: results.length - passed, cases: results }
mkdirSync(new URL('./report/', import.meta.url), { recursive: true })
writeFileSync(new URL('./report/report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`)

for (const entry of results) {
  console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${entry.id}${entry.pass ? '' : `  ${entry.checks.join('; ')}`}`)
}
console.log(`\n${passed}/${results.length} passed`)
process.exitCode = passed === results.length ? 0 : 1
