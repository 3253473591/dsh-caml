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

test('an unknown coordinate returns the empty contract instead of an error', async () => {
  await withStore(async (store) => {
    const audit = await store.audit('我', '目标城市')
    assert.deepEqual(audit.timeline, [])
    assert.deepEqual(audit.adjudications, [])
    assert.equal(audit.summary.current, null)
    assert.equal(audit.summary.versions, 0)
    assert.deepEqual(audit.truncated, { timeline: false, adjudications: false })
  })
})

test('three versions reconstruct the timeline and adjudication log', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })
    await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 })
    await store.remember({ subject: '我', predicate: '目标城市', object: '北京', observedAt: 3_000 })

    const audit = await store.audit('我', '目标城市')
    assert.equal(audit.summary.versions, 3)
    assert.equal(audit.summary.current?.object, '北京')
    assert.deepEqual(
      audit.timeline.map((entry) => entry.fact.object),
      ['杭州', '上海', '北京'],
    )
    assert.deepEqual(
      audit.timeline.map((entry) => entry.fact.status),
      ['superseded', 'superseded', 'active'],
    )
    assert.equal(audit.timeline[0]?.relation, 'SUPERSEDES')
    assert.equal(audit.timeline[2]?.relation, null)
    assert.equal(audit.timeline[0]?.adjudicationId, audit.adjudications[0]?.id)
    assert.equal(audit.adjudications.length, 2)
    assert.deepEqual(audit.adjudications[0]?.previousIds, [audit.timeline[0]?.fact.id])
  })
})

test('limit truncates the timeline and reports it', async () => {
  await withStore(async (store) => {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })
    await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 })
    await store.remember({ subject: '我', predicate: '目标城市', object: '北京', observedAt: 3_000 })

    const audit = await store.audit('我', '目标城市', 2)
    assert.equal(audit.timeline.length, 2)
    assert.equal(audit.truncated.timeline, true)
  })
})
