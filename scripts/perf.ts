import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openStore } from '../src/store/sqlite.js'

const dir = await mkdtemp(join(tmpdir(), 'caml-perf-'))
const dbPath = join(dir, 'caml.db')
const store = await openStore(dbPath)

const SEED = 10_000
const base = Date.now() - 20_000_000

const seed = new DatabaseSync(dbPath)
seed.exec('BEGIN IMMEDIATE')
const insert = seed.prepare(
  `INSERT INTO facts (id, subject, predicate, object, status, weight, valid_from, created_at)
   VALUES (?, ?, 'p', ?, 'active', 1, ?, ?)`,
)
for (let index = 0; index < SEED; index += 1) {
  insert.run(`f_seed_${index}`, `s${index}`, `v${index}`, base + index, base + index)
}
seed.exec('COMMIT')
seed.close()

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

const time = async (fn: () => Promise<unknown>, runs: number): Promise<number[]> => {
  const samples: number[] = []
  for (let index = 0; index < runs; index += 1) {
    const start = process.hrtime.bigint()
    await fn()
    samples.push(Number(process.hrtime.bigint() - start) / 1e6)
  }
  return samples
}

const rememberSamples = await time(
  () => store.remember({ subject: `s${Date.now()}_${Math.random()}`, predicate: 'p', object: 'x', observedAt: base + 1_000_000 }),
  1_000,
)
const recallSamples = await time(() => store.recall({ limit: 20 }), 1_000)
const auditSamples = await time(() => store.audit('s0', 'p'), 200)

const result = {
  environment: { node: process.version, platform: process.platform },
  seedFacts: SEED,
  dbBytes: statSync(dbPath).size,
  remember: { p50: percentile(rememberSamples, 0.5), p95: percentile(rememberSamples, 0.95) },
  recall: { p50: percentile(recallSamples, 0.5), p95: percentile(recallSamples, 0.95) },
  audit: { p50: percentile(auditSamples, 0.5), p95: percentile(auditSamples, 0.95) },
}

mkdirSync('evidence/AC-7', { recursive: true })
writeFileSync('evidence/AC-7/perf.json', `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))

await store.close()
await rm(dir, { recursive: true, force: true })
