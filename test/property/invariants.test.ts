import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openStore } from '../../src/store/sqlite.js'
import type { Strategy } from '../../src/domain/types.js'

const mulberry32 = (seed: number): (() => number) => {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const strategies: Strategy[] = ['supersede', 'versioned_transfer', 'weighted_decay']
const subjects = ['我', '项目A', '项目B']
const predicates = ['城市', '负责人', '偏好']
const objects = ['甲', '乙', '丙', '丁']

test('invariants hold across 500 random writes with a fixed seed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  const dbPath = join(dir, 'caml.db')
  const store = await openStore(dbPath)
  const random = mulberry32(42)

  try {
    const base = Date.parse('2026-01-01T00:00:00Z')
    for (let index = 0; index < 500; index += 1) {
      const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)] as T
      await store.remember({
        subject: pick(subjects),
        predicate: pick(predicates),
        object: pick(objects),
        observedAt: base + index * 1_000,
        strategy: pick(strategies),
        decayFactor: 0.5,
      })

      const db = new DatabaseSync(dbPath)
      try {
        const duplicates = db.prepare(
          `SELECT subject, predicate, COUNT(*) AS n FROM facts
           WHERE status = 'active' AND valid_until IS NULL
           GROUP BY subject, predicate HAVING n > 1`,
        ).all()
        assert.deepEqual(duplicates, [], `INV-1 broken at write ${index}`)

        const badWindow = db.prepare(
          'SELECT id FROM facts WHERE valid_until IS NOT NULL AND valid_until <= valid_from',
        ).all()
        assert.deepEqual(badWindow, [], `INV-6 broken at write ${index}`)
      } finally {
        db.close()
      }
    }

    const before = await store.recall({ limit: 100 })
    await store.remember({
      subject: '我', predicate: '城市', object: '甲', observedAt: base + 500_000, strategy: 'supersede',
    })
    const repeat = await store.remember({
      subject: '我', predicate: '城市', object: '甲', observedAt: base + 500_000, strategy: 'supersede',
    })
    assert.equal(repeat.action, 'duplicate')
    const after = await store.recall({ limit: 100 })
    assert.equal(before.facts.length, after.facts.length)
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
})
