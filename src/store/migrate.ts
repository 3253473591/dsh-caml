import type { DatabaseSync } from 'node:sqlite'

import { CamlError } from '../errors.js'
import { DDL, SCHEMA_VERSION } from './schema.js'

interface UserVersionRow {
  user_version: number
}

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as UserVersionRow | undefined
  return Number(row?.user_version ?? 0)
}

/** Create or verify the schema. A database from a newer plugin is refused, never migrated down. */
export function ensureSchema(db: DatabaseSync): void {
  const version = readUserVersion(db)
  if (version === SCHEMA_VERSION) return
  if (version > SCHEMA_VERSION) {
    throw new CamlError(
      'ERR-STORE-003',
      `记忆库版本 ${version} 高于插件支持的版本 ${SCHEMA_VERSION}`,
      { hint: '升级插件，不要用旧版本写入' },
    )
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(DDL)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
