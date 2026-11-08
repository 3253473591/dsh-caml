import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../../src/store/sqlite.js'
import { CamlError } from '../../src/errors.js'

const isCaml = (code: string) => (error: unknown): boolean =>
  error instanceof CamlError && error.code === code

test('a corrupt database file fails with ERR-STORE-004 and is left in place', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  const dbPath = join(dir, 'caml.db')
  writeFileSync(dbPath, 'this is not a sqlite database', 'utf8')
  try {
    await assert.rejects(openStore(dbPath), isCaml('ERR-STORE-004'))
    assert.equal(existsSync(dbPath), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the schema is not silently recreated over a non-sqlite file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  const dbPath = join(dir, 'caml.db')
  writeFileSync(dbPath, 'garbage', 'utf8')
  try {
    await assert.rejects(openStore(dbPath))
    const { readFileSync } = await import('node:fs')
    assert.equal(readFileSync(dbPath, 'utf8'), 'garbage')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
