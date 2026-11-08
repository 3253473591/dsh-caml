import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../../src/store/sqlite.js'

test('openStore creates missing parent directories for the database path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  const dbPath = join(dir, 'nested', 'deeper', 'caml.db')
  const store = await openStore(dbPath)
  try {
    assert.equal(existsSync(dbPath), true)
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
})
