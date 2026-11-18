import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../../src/store/sqlite.js'
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

const seed = async (store: FactStore): Promise<void> => {
  await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })
  await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 })
}

test('default lookup by object returns only the current value', async () => {
  await withStore(async (store) => {
    await seed(store)
    assert.deepEqual((await store.recall({ object: '上海' })).facts.map((f) => f.object), ['上海'])
    assert.deepEqual((await store.recall({ object: '杭州' })).facts, [])
  })
})

test('includeHistory expands to every version of the matched coordinate', async () => {
  await withStore(async (store) => {
    await seed(store)
    const result = await store.recall({ object: '杭州', includeHistory: true })
    assert.deepEqual(result.facts.map((f) => f.object), ['杭州', '上海'])
    assert.deepEqual(result.facts.map((f) => f.status), ['superseded', 'active'])
  })
})

test('includeHistory matches case-insensitively without fuzzy semantics', async () => {
  await withStore(async (store) => {
    await seed(store)
    const hit = await store.recall({ object: 'shanghai', includeHistory: true })
    assert.deepEqual(hit.facts, [])
    const exact = await store.recall({ object: '上海', includeHistory: true })
    assert.equal(exact.facts.length, 2)
  })
})

test('history is not leaked when includeHistory is absent', async () => {
  await withStore(async (store) => {
    await seed(store)
    const result = await store.recall({})
    assert.deepEqual(result.facts.map((f) => f.object), ['上海'])
  })
})
