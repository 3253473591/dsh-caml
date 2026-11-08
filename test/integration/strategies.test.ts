import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../../src/store/sqlite.js'
import { apply } from '../../src/plugin.js'
import { createFakeCtx } from '../harness/ctx.js'
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

test('versioned transfer keeps the timeline and links with TRANSFERS_TO', async () => {
  await withStore(async (store) => {
    await store.remember({
      subject: '支付项目', predicate: '负责人', object: '张三',
      observedAt: 1_000, strategy: 'versioned_transfer',
    })
    const result = await store.remember({
      subject: '支付项目', predicate: '负责人', object: '李四',
      observedAt: 2_000, strategy: 'versioned_transfer',
    })
    assert.equal(result.action, 'transferred')

    const audit = await store.audit('支付项目', '负责人')
    assert.deepEqual(audit.timeline.map((entry) => entry.relation), ['TRANSFERS_TO', null])
    assert.deepEqual(audit.timeline.map((entry) => entry.fact.status), ['superseded', 'active'])
  })
})

test('weighted decay lowers the old weight without closing its window', async () => {
  await withStore(async (store) => {
    await store.remember({
      subject: '我', predicate: '住宿偏好', object: '青旅',
      observedAt: 1_000, strategy: 'weighted_decay', decayFactor: 0.5,
    })
    const result = await store.remember({
      subject: '我', predicate: '住宿偏好', object: '酒店',
      observedAt: 2_000, strategy: 'weighted_decay', decayFactor: 0.5,
    })
    assert.equal(result.action, 'decayed')

    const active = await store.recall({})
    assert.deepEqual(active.facts.map((fact) => fact.object), ['酒店'])

    const withDecayed = await store.recall({ includeDecayed: true })
    const old = withDecayed.facts.find((fact) => fact.object === '青旅')
    assert.equal(old?.weight, 0.5)
    assert.equal(old?.validUntil, null)
  })
})

test('a second decay multiplies the weight again', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '住宿偏好', object: 'A', observedAt: 1_000, strategy: 'weighted_decay' })
    await store.remember({ subject: '我', predicate: '住宿偏好', object: 'B', observedAt: 2_000, strategy: 'weighted_decay' })
    await store.remember({ subject: '我', predicate: '住宿偏好', object: 'C', observedAt: 3_000, strategy: 'weighted_decay' })
    const all = await store.recall({ includeDecayed: true })
    const weights = Object.fromEntries(all.facts.map((fact) => [fact.object, fact.weight]))
    assert.equal(weights['A'], 0.25)
    assert.equal(weights['B'], 0.5)
    assert.equal(weights['C'], 1)
  })
})

test('asOf returns what was true then and ignores the weight threshold by default', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })
    await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 })

    const before = await store.recall({ asOf: 1_500 })
    assert.deepEqual(before.facts.map((fact) => fact.object), ['杭州'])

    const after = await store.recall({ asOf: 2_500 })
    assert.deepEqual(after.facts.map((fact) => fact.object), ['上海'])
  })
})

test('config maps a predicate to a strategy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  const { ctx, tools } = createFakeCtx()
  const dispose = await apply(ctx, {
    storage: { dbPath: join(dir, 'caml.db') },
    strategies: { byPredicate: { role: 'versioned_transfer' } },
  })
  try {
    const remember = tools.get('caml-remember')
    assert.ok(remember)
    await remember.execute({ subject: '项目', predicate: 'role', object: '张三', observedAt: '2026-01-01T00:00:00Z' })
    const result = await remember.execute({ subject: '项目', predicate: 'role', object: '李四', observedAt: '2026-02-01T00:00:00Z' }) as { action: string }
    assert.equal(result.action, 'transferred')
  } finally {
    dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
