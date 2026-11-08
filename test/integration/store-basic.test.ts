import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openStore } from '../../src/store/sqlite.js'
import { CamlError } from '../../src/errors.js'

const withTempDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const isCaml = (code: string) => (error: unknown): boolean =>
  error instanceof CamlError && error.code === code

test('opening a new database creates the schema, sets user_version 1 and WAL', async () => {
  await withTempDir(async (dir) => {
    const dbPath = join(dir, 'caml.db')
    const store = await openStore(dbPath)
    const probe = new DatabaseSync(dbPath)
    try {
      const version = probe.prepare('PRAGMA user_version').get() as { user_version: number }
      assert.equal(version.user_version, 1)

      const journal = probe.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      assert.equal(journal.journal_mode, 'wal')

      const tables = probe
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name)
      assert.deepEqual(tables, ['adjudication_log', 'fact_relations', 'facts', 'schema_meta'])

      const index = probe
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='ux_facts_one_active'")
        .get()
      assert.ok(index)
    } finally {
      probe.close()
      await store.close()
    }
  })
})

test('reopening an existing database is idempotent', async () => {
  await withTempDir(async (dir) => {
    const dbPath = join(dir, 'caml.db')
    const first = await openStore(dbPath)
    await first.close()
    const second = await openStore(dbPath)
    await second.close()
  })
})

test('a path that is an existing directory fails with ERR-STORE-001', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(openStore(dir), isCaml('ERR-STORE-001'))
  })
})

test('a database written by a newer schema is refused with ERR-STORE-003', async () => {
  await withTempDir(async (dir) => {
    const dbPath = join(dir, 'caml.db')
    const probe = new DatabaseSync(dbPath)
    probe.exec('PRAGMA user_version = 2')
    probe.close()
    await assert.rejects(openStore(dbPath), isCaml('ERR-STORE-003'))
  })
})
