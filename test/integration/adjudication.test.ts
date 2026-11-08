import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openStore } from '../../src/store/sqlite.js'

const withStore = async (fn: (store: Awaited<ReturnType<typeof openStore>>, dbPath: string) => Promise<void>) => {
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

const readAll = (dbPath: string) => {
  const db = new DatabaseSync(dbPath)
  try {
    const facts = db.prepare('SELECT * FROM facts ORDER BY valid_from ASC').all() as Array<Record<string, unknown>>
    const relations = db.prepare('SELECT * FROM fact_relations').all() as Array<Record<string, unknown>>
    const logs = db.prepare('SELECT * FROM adjudication_log').all() as Array<Record<string, unknown>>
    return { facts, relations, logs }
  } finally {
    db.close()
  }
}

test('supersede closes the old fact and default recall returns only the new one', async () => {
  await withStore(async (store, dbPath) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })
    const result = await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 })

    assert.equal(result.action, 'superseded')
    assert.equal(result.strategy, 'supersede')

    const recalled = await store.recall({})
    assert.deepEqual(recalled.facts.map((fact) => fact.object), ['上海'])

    const { facts, relations, logs } = readAll(dbPath)
    const old = facts.find((fact) => fact.object === '杭州')
    assert.equal(old?.status, 'superseded')
    assert.equal(old?.valid_until, 2_000)
    assert.equal(old?.superseded_by, result.fact.id)
    assert.equal(relations.length, 1)
    assert.equal(relations[0]?.relation_type, 'SUPERSEDES')
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.result_fact_id, result.fact.id)
  })
})

test('writing back an older value produces a new version, not a duplicate', async () => {
  await withStore(async (store, dbPath) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })
    await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 })
    const back = await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 3_000 })

    assert.equal(back.action, 'superseded')
    const { facts } = readAll(dbPath)
    assert.equal(facts.length, 3)
    assert.deepEqual(
      facts.map((fact) => fact.status),
      ['superseded', 'superseded', 'active'],
    )
  })
})
