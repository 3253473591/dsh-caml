import { isAbsolute, join, resolve } from 'node:path'

import { CamlError } from './errors.js'
import { PREDICATE_PATTERN } from './domain/validate.js'
import type { Strategy } from './domain/types.js'

export interface CamlConfig {
  dbPath: string
  strategies: {
    default: Strategy
    byPredicate: Record<string, Strategy>
    decayFactor: number
    minWeight: number
  }
  limits: {
    maxObjectChars: number
    maxMetadataBytes: number
  }
  time: {
    futureSkewMs: number
  }
}

export interface ConfigEnv {
  cwd?: string
  dshHome?: string | null
}

const STRATEGIES: readonly Strategy[] = ['supersede', 'versioned_transfer', 'weighted_decay']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readStrategy = (value: unknown, path: string): Strategy => {
  if (typeof value !== 'string' || !STRATEGIES.includes(value as Strategy)) {
    throw new CamlError('ERR-CONF-003', `${path} 未知策略；可选值 ${STRATEGIES.join(' / ')}`)
  }
  return value as Strategy
}

const readNumber = (value: unknown, fallback: number, min: number, max: number, path: string): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new CamlError('ERR-CONF-001', `${path} 必须是 ${min}–${max} 之间的数字`)
  }
  return value
}

export function resolveConfig(raw: unknown, env: ConfigEnv = {}): CamlConfig {
  if (raw !== undefined && !isRecord(raw)) {
    throw new CamlError('ERR-CONF-001', 'config 必须是对象')
  }
  const root = isRecord(raw) ? raw : {}
  const storage = isRecord(root.storage) ? root.storage : {}
  const strategiesRaw = isRecord(root.strategies) ? root.strategies : {}
  const limits = isRecord(root.limits) ? root.limits : {}
  const time = isRecord(root.time) ? root.time : {}

  const configuredPath = storage.dbPath
  if (configuredPath !== undefined && (typeof configuredPath !== 'string' || configuredPath.trim() === '')) {
    throw new CamlError('ERR-CONF-002', 'storage.dbPath 必须是非空文件路径')
  }

  const cwd = env.cwd ?? process.cwd()
  const dshHome = env.dshHome ?? process.env.DSH_HOME ?? null
  const dbPath = configuredPath === undefined
    ? (dshHome === null ? join(cwd, '.dsh-caml', 'caml.db') : join(dshHome, 'caml', 'caml.db'))
    : (isAbsolute(configuredPath) ? configuredPath : resolve(cwd, configuredPath))

  const byPredicateRaw = isRecord(strategiesRaw.byPredicate) ? strategiesRaw.byPredicate : {}
  const byPredicate: Record<string, Strategy> = {}
  for (const [predicate, strategy] of Object.entries(byPredicateRaw)) {
    if (!PREDICATE_PATTERN.test(predicate)) {
      throw new CamlError('ERR-CONF-001', `strategies.byPredicate 的 key 不是合法 predicate：${predicate}`)
    }
    byPredicate[predicate] = readStrategy(strategy, `strategies.byPredicate[${predicate}]`)
  }

  return {
    dbPath,
    strategies: {
      default: strategiesRaw.default === undefined
        ? 'supersede'
        : readStrategy(strategiesRaw.default, 'strategies.default'),
      byPredicate,
      decayFactor: readNumber(strategiesRaw.decayFactor, 0.5, 0.05, 0.95, 'strategies.decayFactor'),
      minWeight: readNumber(strategiesRaw.minWeight, 0.3, 0, 1, 'strategies.minWeight'),
    },
    limits: {
      maxObjectChars: readNumber(limits.maxObjectChars, 2000, 64, 8000, 'limits.maxObjectChars'),
      maxMetadataBytes: readNumber(limits.maxMetadataBytes, 4096, 256, 65536, 'limits.maxMetadataBytes'),
    },
    time: {
      futureSkewMs: readNumber(time.futureSkewMs, 300_000, 0, 86_400_000, 'time.futureSkewMs'),
    },
  }
}
