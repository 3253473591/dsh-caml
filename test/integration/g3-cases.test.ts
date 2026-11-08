import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openStore } from '../../src/store/sqlite.js'
import { resolveConfig } from '../../src/config.js'
import { CamlError } from '../../src/errors.js'
import type { FactStore } from '../../src/store/port.js'

const withStore = async (fn: (store: FactStore, dbPath: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  const dbPath = join(dir, 'caml.db')
  const store = await openStore(dbPath)
  try {
    await fn(store, dbPath)
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
}

const isCaml = (code: string) => (error: unknown): boolean =>
  error instanceof CamlError && error.code === code

test('TC-2.5: a decayed fact can be superseded explicitly', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '偏好', object: 'A', observedAt: 1_000, strategy: 'weighted_decay' })
    await store.remember({ subject: '我', predicate: '偏好', object: 'B', observedAt: 2_000, strategy: 'weighted_decay' })
    await store.remember({ subject: '我', predicate: '偏好', object: 'C', observedAt: 3_000, strategy: 'supersede' })

    const audit = await store.audit('我', '偏好')
    assert.deepEqual(audit.timeline.map((entry) => entry.fact.status), ['superseded', 'superseded', 'active'])
    assert.ok(audit.timeline.every((entry) => entry.fact.validUntil !== null || entry.fact.status === 'active'))
  })
})

test('TC-2.6: several current facts still produce exactly one log row', async () => {
  await withStore(async (store, dbPath) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })

    const db = new DatabaseSync(dbPath)
    try {
      db.exec('DROP INDEX ux_facts_one_active')
      db.prepare(
        `INSERT INTO facts (id, subject, predicate, object, status, weight, valid_from, created_at)
         VALUES ('f_manual', '我', '目标城市', '南京', 'active', 1, 1500, 1500)`,
      ).run()
    } finally {
      db.close()
    }

    await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 3_000 })

    const check = new DatabaseSync(dbPath)
    try {
      const logs = check.prepare('SELECT COUNT(*) AS n FROM adjudication_log').get() as { n: number }
      const relations = check.prepare('SELECT COUNT(*) AS n FROM fact_relations').get() as { n: number }
      assert.equal(logs.n, 1)
      assert.equal(relations.n, 2)
    } finally {
      check.close()
    }
  })
})

test('TC-3.6: minWeight filters recall results', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '偏好', object: 'A', observedAt: 1_000, strategy: 'weighted_decay' })
    await store.remember({ subject: '我', predicate: '偏好', object: 'B', observedAt: 2_000, strategy: 'weighted_decay' })

    const filtered = await store.recall({ includeDecayed: true, minWeight: 0.8 })
    assert.deepEqual(filtered.facts.map((fact) => fact.object), ['B'])
  })
})

test('TC-4.4/4.5/4.6: asOf boundaries are left-closed and right-open', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })
    await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 })

    const boundary = await store.recall({ asOf: 2_000 })
    assert.deepEqual(boundary.facts.map((fact) => fact.object), ['上海'])

    const future = await store.recall({ asOf: Date.now() + 60_000 })
    assert.deepEqual(future.facts.map((fact) => fact.object), ['上海'])

    const beforeFirst = await store.recall({ asOf: 500 })
    assert.deepEqual(beforeFirst.facts, [])
  })
})

test('TC-5: invalid configuration is rejected with a stable code', () => {
  const base = { cwd: '/' }
  assert.equal(
    (() => { try { resolveConfig({ strategies: { decayFactor: 0.99 } }, base); return 'NO_ERROR' } catch (error) { return (error as CamlError).code } })(),
    'ERR-CONF-001',
  )
  assert.equal(
    (() => { try { resolveConfig({ storage: { dbPath: '' } }, base); return 'NO_ERROR' } catch (error) { return (error as CamlError).code } })(),
    'ERR-CONF-002',
  )
  assert.equal(
    (() => { try { resolveConfig({ strategies: { byPredicate: { 'bad key': 'supersede' } } }, base); return 'NO_ERROR' } catch (error) { return (error as CamlError).code } })(),
    'ERR-CONF-001',
  )
  assert.equal(
    (() => { try { resolveConfig({ limits: { maxObjectChars: 10 } }, base); return 'NO_ERROR' } catch (error) { return (error as CamlError).code } })(),
    'ERR-CONF-001',
  )
  assert.throws(() => resolveConfig({ strategies: { default: 'foo' } }, base), isCaml('ERR-CONF-003'))
})
