import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openStore } from '../lib/store/sqlite.js'

const dir = mkdtempSync(join(tmpdir(), 'caml-dump-'))
const dbPath = join(dir, 'caml.db')

const store = await openStore(dbPath)
await store.close()

const db = new DatabaseSync(dbPath)
try {
  const version = db.prepare('PRAGMA user_version').get()
  const journal = db.prepare('PRAGMA journal_mode').get()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name)
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name)

  console.log('user_version', version.user_version)
  console.log('journal_mode', journal.journal_mode)
  console.log('tables', tables.join(','))
  console.log('indexes', indexes.join(','))
} finally {
  db.close()
}
