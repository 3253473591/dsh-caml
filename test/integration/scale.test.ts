import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../../src/store/sqlite.js'

const base = Date.now() - 10_000_000

test('S-1: facts and the timeline survive a store restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-scale-'))
  const dbPath = join(dir, 'caml.db')
  try {
    const first = await openStore(dbPath)
    for (const [index, city] of ['杭州', '上海', '北京'].entries()) {
      await first.remember({
        subject: '我', predicate: '目标城市', object: city, observedAt: base + index * 1_000,
      })
    }
    await first.close()

    const second = await openStore(dbPath)
    try {
      const recalled = await second.recall({ subject: '我', predicate: '目标城市' })
      assert.deepEqual(recalled.facts.map((fact) => fact.object), ['北京'])

      const audit = await second.audit('我', '目标城市')
      assert.equal(audit.summary.versions, 3)
      assert.deepEqual(
        audit.timeline.map((entry) => entry.fact.status),
        ['superseded', 'superseded', 'active'],
      )
    } finally {
      await second.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('S-2: 40 conflicting coordinates stay correct among 200 distractors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-scale-'))
  const store = await openStore(join(dir, 'caml.db'))
  try {
    for (let index = 0; index < 200; index += 1) {
      await store.remember({
        subject: `干扰${index}`, predicate: '备注', object: `值${index}`,
        observedAt: base + index,
      })
    }
    for (let coordinate = 0; coordinate < 40; coordinate += 1) {
      for (let version = 0; version < 3; version += 1) {
        await store.remember({
          subject: `项目${coordinate}`, predicate: '负责人', object: `人${coordinate}-${version}`,
          observedAt: base + 100_000 + coordinate * 100 + version,
        })
      }
    }

    for (const coordinate of [0, 7, 13, 21, 28, 39]) {
      const recalled = await store.recall({ subject: `项目${coordinate}`, predicate: '负责人' })
      assert.deepEqual(recalled.facts.map((fact) => fact.object), [`人${coordinate}-2`])
      const audit = await store.audit(`项目${coordinate}`, '负责人')
      assert.equal(audit.summary.versions, 3)
    }
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('S-3: asOf answers a middle version precisely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-scale-'))
  const store = await openStore(join(dir, 'caml.db'))
  try {
    const values = ['A', 'B', 'C', 'D', 'E']
    for (const [index, value] of values.entries()) {
      await store.remember({
        subject: '项目', predicate: '阶段', object: value, observedAt: base + index * 10_000,
      })
    }

    const at = base + 25_000
    const recalled = await store.recall({ subject: '项目', predicate: '阶段', asOf: at })
    assert.deepEqual(recalled.facts.map((fact) => fact.object), ['C'])

    const audit = await store.audit('项目', '阶段')
    assert.equal(audit.summary.versions, 5)
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
})
