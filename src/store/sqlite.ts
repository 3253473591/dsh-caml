import { DatabaseSync } from 'node:sqlite'

import { CamlError, isCamlError } from '../errors.js'
import { ensureSchema } from './migrate.js'
import type { FactStore } from './port.js'

export class SqliteStore implements FactStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  /** Internal escape hatch for the sibling store modules; never exported through the port. */
  get database(): DatabaseSync {
    return this.#db
  }

  async close(): Promise<void> {
    this.#db.close()
  }
}

/** Open (or create) the database at `dbPath`, apply pragmas and migrate the schema. */
export async function openStore(dbPath: string): Promise<SqliteStore> {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath)
  } catch (error) {
    throw new CamlError('ERR-STORE-001', `无法打开记忆库：${dbPath}`, {
      details: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 2000')
    db.exec('PRAGMA foreign_keys = ON')
    ensureSchema(db)
  } catch (error) {
    db.close()
    if (isCamlError(error)) throw error
    throw new CamlError('ERR-STORE-001', `初始化记忆库失败：${dbPath}`, {
      details: error instanceof Error ? error.message : String(error),
    })
  }

  return new SqliteStore(db)
}
