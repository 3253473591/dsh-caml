import { DatabaseSync } from 'node:sqlite'

import { CamlError, isCamlError } from '../errors.js'
import { objectKey } from '../domain/normalize.js'
import { assertObject, assertPredicate, assertSubject } from '../domain/validate.js'
import { newFactId } from '../domain/id.js'
import type { Fact, FactStatus, NewFactInput } from '../domain/types.js'
import { ensureSchema } from './migrate.js'
import type { FactStore, RecallQuery, RecallResult, RememberResult } from './port.js'

const FUTURE_SKEW_MS = 5 * 60 * 1000
const DEFAULT_LIMIT = 20

interface FactRow {
  id: string
  subject: string
  predicate: string
  object: string
  status: FactStatus
  weight: number
  valid_from: number
  valid_until: number | null
  superseded_by: string | null
  created_at: number
  source_session: string | null
  metadata: string | null
}

const rowToFact = (row: FactRow): Fact => ({
  id: row.id,
  subject: row.subject,
  predicate: row.predicate,
  object: row.object,
  status: row.status,
  weight: row.weight,
  validFrom: row.valid_from,
  validUntil: row.valid_until,
  supersededBy: row.superseded_by,
  createdAt: row.created_at,
  sourceSession: row.source_session,
  metadata: row.metadata === null ? null : (JSON.parse(row.metadata) as Record<string, unknown>),
})

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&')

export class SqliteStore implements FactStore {
  readonly #db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.#db = db
  }

  async current(subject: string, predicate: string): Promise<Fact[]> {
    const rows = this.#db
      .prepare(
        `SELECT * FROM facts
         WHERE subject = ? AND predicate = ? AND valid_until IS NULL
           AND status IN ('active','decayed')
         ORDER BY valid_from ASC, id ASC`,
      )
      .all(subject, predicate) as unknown as FactRow[]
    return rows.map(rowToFact)
  }

  async remember(input: NewFactInput): Promise<RememberResult> {
    const subject = assertSubject(input.subject)
    const predicate = assertPredicate(input.predicate)
    const object = assertObject(input.object)
    const observedAt = input.observedAt
    const now = Date.now()

    if (observedAt > now + FUTURE_SKEW_MS) {
      throw new CamlError('ERR-INPUT-004', 'observedAt 晚于当前时间 5 分钟以上，拒绝写入')
    }

    const currentFacts = await this.current(subject, predicate)
    for (const fact of currentFacts) {
      if (objectKey(fact.object) === objectKey(object)) {
        return { fact, action: 'duplicate' }
      }
    }

    const latestValidFrom = currentFacts.reduce<number | null>(
      (latest, fact) => (latest === null || fact.validFrom > latest ? fact.validFrom : latest),
      null,
    )
    if (latestValidFrom !== null && observedAt <= latestValidFrom) {
      throw new CamlError('ERR-STATE-002', '不允许补写历史：新事实时间早于或等于当前事实')
    }

    if (currentFacts.length > 0) {
      // Replaced by the adjudicator in T2.1.
      throw new CamlError('ERR-INT-001', '冲突裁决尚未实现（T2.1）')
    }

    const fact: Fact = {
      id: newFactId(now),
      subject,
      predicate,
      object,
      status: 'active',
      weight: 1,
      validFrom: observedAt,
      validUntil: null,
      supersededBy: null,
      createdAt: now,
      sourceSession: input.sourceSession ?? null,
      metadata: input.metadata ?? null,
    }

    this.#db
      .prepare(
        `INSERT INTO facts
           (id, subject, predicate, object, status, weight, valid_from, valid_until,
            superseded_by, created_at, source_session, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fact.id,
        fact.subject,
        fact.predicate,
        fact.object,
        fact.status,
        fact.weight,
        fact.validFrom,
        fact.validUntil,
        fact.supersededBy,
        fact.createdAt,
        fact.sourceSession,
        fact.metadata === null ? null : JSON.stringify(fact.metadata),
      )

    return { fact, action: 'created' }
  }

  async recall(query: RecallQuery = {}): Promise<RecallResult> {
    const limit = query.limit ?? DEFAULT_LIMIT
    const where: string[] = ['valid_until IS NULL']
    const params: (string | number)[] = []

    if (query.includeDecayed === true) {
      where.push("status IN ('active','decayed')")
    } else {
      where.push("status = 'active'")
    }
    if (query.subject !== undefined) {
      where.push('subject = ?')
      params.push(query.subject)
    }
    if (query.predicate !== undefined) {
      where.push('predicate = ?')
      params.push(query.predicate)
    }
    if (query.query !== undefined && query.query !== '') {
      const like = `%${escapeLike(query.query)}%`
      where.push("(subject LIKE ? ESCAPE '\\' OR object LIKE ? ESCAPE '\\')")
      params.push(like, like)
    }
    if (query.minWeight !== undefined) {
      where.push('weight >= ?')
      params.push(query.minWeight)
    }

    const rows = this.#db
      .prepare(
        `SELECT * FROM facts WHERE ${where.join(' AND ')}
         ORDER BY weight DESC, valid_from DESC, id ASC
         LIMIT ?`,
      )
      .all(...params, limit + 1) as unknown as FactRow[]

    const truncated = rows.length > limit
    return { facts: rows.slice(0, limit).map(rowToFact), truncated }
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
