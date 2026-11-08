import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../../src/store/sqlite.js'
import { CamlError } from '../../src/errors.js'
import type { FactStore } from '../../src/store/port.js'

const withStore = async (fn: (store: FactStore) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  const store = await openStore(join(dir, 'caml.db'))
  try {
    await fn(store)
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
}

const isCaml = (code: string) => (error: unknown): boolean =>
  error instanceof CamlError && error.code === code

test('the first write creates an active fact and recall returns it', async () => {
  await withStore(async (store) => {
    const result = await store.remember({
      subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000,
    })
    assert.equal(result.action, 'created')
    assert.equal(result.fact.status, 'active')
    assert.equal(result.fact.weight, 1)

    const recalled = await store.recall({ subject: '我', predicate: '目标城市' })
    assert.deepEqual(recalled.facts.map((fact) => fact.object), ['杭州'])
    assert.equal(recalled.truncated, false)
  })
})

test('rewriting the same object is a duplicate and adds no row', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })
    const again = await store.remember({
      subject: '我', predicate: '目标城市', object: ' 杭州 ', observedAt: 2_000,
    })
    assert.equal(again.action, 'duplicate')
    const recalled = await store.recall({})
    assert.equal(recalled.facts.length, 1)
  })
})

test('a blank subject is rejected before touching the database', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      store.remember({ subject: '   ', predicate: '目标城市', object: '杭州', observedAt: 1_000 }),
      isCaml('ERR-INPUT-008'),
    )
  })
})

test('an observedAt far in the future is rejected', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      store.remember({
        subject: '我', predicate: '目标城市', object: '杭州',
        observedAt: Date.now() + 10 * 60 * 1000,
      }),
      isCaml('ERR-INPUT-004'),
    )
  })
})

test('writing at or before the current valid_from is rejected', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 2_000 })
    await assert.rejects(
      store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 }),
      isCaml('ERR-STATE-002'),
    )
  })
})

test('recall honours the limit and reports truncation', async () => {
  await withStore(async (store) => {
    const predicates = ['目标城市', '目标岗位', '目标行业']
    for (const [index, predicate] of predicates.entries()) {
      await store.remember({
        subject: '我', predicate, object: `值${index}`, observedAt: 1_000 + index,
      })
    }
    const recalled = await store.recall({ limit: 2 })
    assert.equal(recalled.facts.length, 2)
    assert.equal(recalled.truncated, true)
  })
})

test('recall treats LIKE wildcards as literals', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '折扣', object: '50%', observedAt: 1_000 })
    await store.remember({ subject: '我', predicate: '价格', object: '500 元', observedAt: 2_000 })
    const recalled = await store.recall({ query: '50%' })
    assert.deepEqual(recalled.facts.map((fact) => fact.object), ['50%'])
  })
})
