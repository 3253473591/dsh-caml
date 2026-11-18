import { DatabaseSync } from 'node:sqlite'
import { closeSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

import { CamlError, isCamlError } from '../errors.js'
import { planAdjudication } from '../domain/adjudicator.js'
import { objectKey } from '../domain/normalize.js'
import { assertObject, assertPredicate, assertSubject } from '../domain/validate.js'
import { newAdjudicationId, newFactId } from '../domain/id.js'
import type { AdjudicationPlan, Fact, FactStatus, NewFactInput, RelationType, Strategy } from '../domain/types.js'
import { ensureSchema } from './migrate.js'
import type {
  AuditAdjudication,
  AuditResult,
  FactStore,
  RecallQuery,
  RecallResult,
  RememberResult,
} from './port.js'

const FUTURE_SKEW_MS = 5 * 60 * 1000
const DEFAULT_LIMIT = 20
const DEFAULT_BUSY_TIMEOUT_MS = 2_000
const DEFAULT_RETRY_COUNT = 2
const DEFAULT_RETRY_DELAY_MS = 50

export interface StoreOptions {
  busyTimeoutMs?: number
  retryCount?: number
  retryDelayMs?: number
}

const isBusy = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  const errcode = (error as { errcode?: unknown }).errcode
  return code === 'ERR_SQLITE_ERROR' && (errcode === 5 || errcode === 6)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const ACTION_BY_STRATEGY: Record<Strategy, RememberResult['action']> = {
  supersede: 'superseded',
  versioned_transfer: 'transferred',
  weighted_decay: 'decayed',
}

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

const rowToFact = (row: FactRow): Fact => ({  id: row.id,
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

interface LogRow {
  id: string
  subject: string
  predicate: string
  conflict_fact_ids: string
  chosen_strategy: Strategy
  result_fact_id: string
  reason: string
  created_at: number
}

const rowToLog = (row: LogRow): AuditAdjudication => ({
  id: row.id,
  at: row.created_at,
  strategy: row.chosen_strategy,
  previousIds: JSON.parse(row.conflict_fact_ids) as string[],
  resultFactId: row.result_fact_id,
  reason: row.reason,
})

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&')

const INSERT_FACT = `INSERT INTO facts
  (id, subject, predicate, object, status, weight, valid_from, valid_until,
   superseded_by, created_at, source_session, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

export class SqliteStore implements FactStore {
  readonly #db: DatabaseSync
  readonly #retryCount: number
  readonly #retryDelayMs: number

  constructor(db: DatabaseSync, options: StoreOptions = {}) {
    // Both node:sqlite and better-sqlite3 re-compile every prepare() call.
    // Caching by SQL text keeps the hot read path at execute cost instead of
    // paying parse/plan per recall (~10ms at 10k facts on this machine).
    const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>()
    this.#db = new Proxy(db, {
      get: (target, property) => {
        if (property === 'prepare') {
          return (sql: string) => {
            const cached = statements.get(sql)
            if (cached !== undefined) return cached
            const created = target.prepare(sql)
            statements.set(sql, created)
            return created
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as DatabaseSync
    this.#retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT
    this.#retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  }

  async #write<T>(operation: () => T): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return operation()
      } catch (error) {
        if (!isBusy(error)) throw error
        if (attempt >= this.#retryCount) {
          throw new CamlError('ERR-STORE-002', '记忆库正被占用，请稍后重试', { retryable: true })
        }
        await sleep(this.#retryDelayMs)
      }
    }
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

    const strategy: Strategy = input.strategy ?? 'supersede'
    const id = newFactId(now)

    if (currentFacts.length === 0) {
      const fact: Fact = {
        id,
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
      await this.#write(() => this.#insertFact(fact))
      return { fact, action: 'created' }
    }

    const plan = planAdjudication({
      current: currentFacts,
      incoming: {
        subject,
        predicate,
        object,
        observedAt,
        sourceSession: input.sourceSession ?? null,
        metadata: input.metadata ?? null,
      },
      strategy,
      now,
      newFactId: id,
      newAdjudicationId: newAdjudicationId(now),
      decayFactor: input.decayFactor,
    })
    await this.#write(() => this.#applyPlan(plan))

    return {
      fact: plan.insert,
      action: ACTION_BY_STRATEGY[strategy],
      strategy,
      adjudication: {
        id: plan.log.id,
        previous: currentFacts.map((fact) => ({
          id: fact.id,
          object: fact.object,
          weight: fact.weight,
          validFrom: fact.validFrom,
          validUntil: observedAt,
        })),
        relation: plan.relations[0]?.relationType ?? 'SUPERSEDES',
      },
    }
  }

  async recall(query: RecallQuery = {}): Promise<RecallResult> {
    if (query.object !== undefined) return this.#recallByObject(query)
    const limit = query.limit ?? DEFAULT_LIMIT
    const where: string[] = []
    const params: (string | number)[] = []

    if (query.asOf !== undefined) {
      where.push('valid_from <= ?')
      where.push('(valid_until IS NULL OR valid_until > ?)')
      params.push(query.asOf, query.asOf)
    } else {
      where.push('valid_until IS NULL')
      where.push(query.includeDecayed === true ? "status IN ('active','decayed')" : "status = 'active'")
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

  #recallByObject(query: RecallQuery): RecallResult {
    const limit = query.limit ?? DEFAULT_LIMIT
    const value = query.object as string
    const key = objectKey(value)
    const where: string[] = ['(object = ? OR lower(object) = lower(?))']
    const params: (string | number)[] = [value, value]

    if (query.subject !== undefined) {
      where.push('subject = ?')
      params.push(query.subject)
    }
    if (query.predicate !== undefined) {
      where.push('predicate = ?')
      params.push(query.predicate)
    }
    if (query.includeHistory !== true) {
      where.push('valid_until IS NULL', "status = 'active'")
    }
    if (query.minWeight !== undefined) {
      where.push('weight >= ?')
      params.push(query.minWeight)
    }

    const candidates = this.#db
      .prepare(`SELECT * FROM facts WHERE ${where.join(' AND ')} ORDER BY valid_from ASC, id ASC LIMIT 1000`)
      .all(...params) as unknown as FactRow[]

    const matched = candidates.map(rowToFact).filter((fact) => objectKey(fact.object) === key)
    if (query.includeHistory !== true) {
      return { facts: matched.slice(0, limit), truncated: matched.length > limit }
    }

    const coordinates = new Map<string, { subject: string; predicate: string }>()
    for (const fact of matched) {
      coordinates.set(`${fact.subject}\u0000${fact.predicate}`, {
        subject: fact.subject,
        predicate: fact.predicate,
      })
    }

    const expanded: Fact[] = []
    const statement = this.#db.prepare(
      'SELECT * FROM facts WHERE subject = ? AND predicate = ? ORDER BY valid_from ASC, id ASC',
    )
    for (const coordinate of coordinates.values()) {
      const rows = statement.all(coordinate.subject, coordinate.predicate) as unknown as FactRow[]
      expanded.push(...rows.map(rowToFact))
    }

    return { facts: expanded.slice(0, limit), truncated: expanded.length > limit }
  }

  async audit(subject: string, predicate: string, limit = 100): Promise<AuditResult> {
    const factRows = this.#db
      .prepare(
        `SELECT * FROM facts WHERE subject = ? AND predicate = ?
         ORDER BY valid_from ASC, id ASC LIMIT ?`,
      )
      .all(subject, predicate, limit) as unknown as FactRow[]

    const logRows = this.#db
      .prepare(
        `SELECT * FROM adjudication_log WHERE subject = ? AND predicate = ?
         ORDER BY created_at ASC, id ASC LIMIT ?`,
      )
      .all(subject, predicate, limit) as unknown as LogRow[]

    const counts = this.#db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM facts WHERE subject = ? AND predicate = ?) AS versions,
           (SELECT COUNT(*) FROM adjudication_log WHERE subject = ? AND predicate = ?) AS adjudications,
           (SELECT MIN(valid_from) FROM facts WHERE subject = ? AND predicate = ?) AS first_at,
           (SELECT MAX(COALESCE(valid_until, valid_from)) FROM facts WHERE subject = ? AND predicate = ?) AS last_at`,
      )
      .get(subject, predicate, subject, predicate, subject, predicate, subject, predicate) as {
        versions: number
        adjudications: number
        first_at: number | null
        last_at: number | null
      }

    const currentRow = this.#db
      .prepare(
        `SELECT * FROM facts WHERE subject = ? AND predicate = ?
           AND status = 'active' AND valid_until IS NULL LIMIT 1`,
      )
      .get(subject, predicate) as FactRow | undefined

    const facts = factRows.map(rowToFact)
    const adjudications = logRows.map(rowToLog)

    const relations = facts.length === 0
      ? []
      : (this.#db
        .prepare(
          `SELECT to_fact_id, relation_type FROM fact_relations
           WHERE to_fact_id IN (${facts.map(() => '?').join(',')})`,
        )
        .all(...facts.map((fact) => fact.id)) as unknown as Array<{
        to_fact_id: string
        relation_type: RelationType
      }>)

    const relationByTo = new Map(relations.map((row) => [row.to_fact_id, row.relation_type]))
    const createdBy = new Map(adjudications.map((entry) => [entry.resultFactId, entry.id]))
    const closedBy = new Map<string, string>()
    for (const entry of adjudications) {
      for (const previousId of entry.previousIds) {
        closedBy.set(previousId, entry.id)
      }
    }

    return {
      subject,
      predicate,
      summary: {
        current: currentRow === undefined ? null : rowToFact(currentRow),
        versions: Number(counts.versions),
        firstAt: counts.first_at,
        lastAt: counts.last_at,
      },
      timeline: facts.map((fact) => ({
        fact,
        relation: relationByTo.get(fact.id) ?? null,
        adjudicationId: closedBy.get(fact.id) ?? createdBy.get(fact.id) ?? null,
      })),
      adjudications,
      truncated: {
        timeline: Number(counts.versions) > facts.length,
        adjudications: Number(counts.adjudications) > adjudications.length,
      },
    }
  }

  async close(): Promise<void> {
    this.#db.close()
  }

  #insertFact(fact: Fact): void {
    this.#db
      .prepare(INSERT_FACT)
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
  }

  #applyPlan(plan: AdjudicationPlan): void {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const close = this.#db.prepare(
        'UPDATE facts SET valid_until = ?, status = ?, superseded_by = ? WHERE id = ?',
      )
      for (const entry of plan.close) {
        close.run(entry.validUntil, entry.status, entry.supersededBy, entry.id)
      }

      const decay = this.#db.prepare('UPDATE facts SET weight = ?, status = ? WHERE id = ?')
      for (const entry of plan.decay) {
        decay.run(entry.weight, entry.status, entry.id)
      }

      this.#insertFact(plan.insert)

      const relation = this.#db.prepare(
        'INSERT INTO fact_relations (from_fact_id, to_fact_id, relation_type, created_at) VALUES (?, ?, ?, ?)',
      )
      for (const entry of plan.relations) {
        relation.run(entry.fromFactId, entry.toFactId, entry.relationType, plan.log.createdAt)
      }

      this.#db
        .prepare(
          `INSERT INTO adjudication_log
             (id, subject, predicate, conflict_fact_ids, chosen_strategy, result_fact_id, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          plan.log.id,
          plan.log.subject,
          plan.log.predicate,
          JSON.stringify(plan.log.conflictFactIds),
          plan.log.chosenStrategy,
          plan.log.resultFactId,
          plan.log.reason,
          plan.log.createdAt,
        )

      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'latin1')

/** Detect a non-SQLite file before SQLite opens it, so we never write over foreign data. */
function assertNotForeignFile(dbPath: string): void {
  let size: number
  try {
    size = statSync(dbPath).size
  } catch {
    return
  }
  if (size === 0) return
  if (size < SQLITE_HEADER.length) {
    throw new CamlError('ERR-STORE-004', `记忆库损坏：${dbPath}`, { hint: '从备份恢复，见 docs/04 排障' })
  }
  const fd = openSync(dbPath, 'r')
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length)
    readSync(fd, buffer, 0, buffer.length, 0)
    if (!buffer.equals(SQLITE_HEADER)) {
      throw new CamlError('ERR-STORE-004', `记忆库损坏：${dbPath}`, { hint: '从备份恢复，见 docs/04 排障' })
    }
  } finally {
    closeSync(fd)
  }
}

/** Open (or create) the database at `dbPath`, apply pragmas and migrate the schema. */
export async function openStore(dbPath: string, options: StoreOptions = {}): Promise<SqliteStore> {
  try {
    mkdirSync(dirname(dbPath), { recursive: true })
  } catch (error) {
    throw new CamlError('ERR-STORE-001', `无法创建记忆库目录：${dirname(dbPath)}`, {
      details: error instanceof Error ? error.message : String(error),
    })
  }
  assertNotForeignFile(dbPath)
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
    db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`)
    db.exec('PRAGMA foreign_keys = ON')
    ensureSchema(db)
  } catch (error) {
    db.close()
    if (isCamlError(error)) throw error
    throw new CamlError('ERR-STORE-001', `初始化记忆库失败：${dbPath}`, {
      details: error instanceof Error ? error.message : String(error),
    })
  }

  return new SqliteStore(db, options)
}
