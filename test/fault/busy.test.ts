import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openStore } from '../../src/store/sqlite.js'
import { CamlError } from '../../src/errors.js'

const isCaml = (code: string) => (error: unknown): boolean =>
  error instanceof CamlError && error.code === code

test('a held write lock surfaces ERR-STORE-002 while reads keep working', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  const dbPath = join(dir, 'caml.db')
  const store = await openStore(dbPath, { busyTimeoutMs: 50, retryCount: 2, retryDelayMs: 10 })
  const blocker = new DatabaseSync(dbPath)

  try {
    await store.remember({ subject: '我', predicate: '目标城市', object: '杭州', observedAt: 1_000 })

    blocker.exec('BEGIN IMMEDIATE')
    await assert.rejects(
      store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 }),
      isCaml('ERR-STORE-002'),
    )

    const recalled = await store.recall({})
    assert.deepEqual(recalled.facts.map((fact) => fact.object), ['杭州'])

    blocker.exec('ROLLBACK')
    const after = await store.remember({ subject: '我', predicate: '目标城市', object: '上海', observedAt: 2_000 })
    assert.equal(after.action, 'superseded')
  } finally {
    blocker.close()
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
})
