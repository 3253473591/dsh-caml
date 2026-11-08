import { CamlError } from '../errors.js'
import type { Strategy } from '../domain/types.js'

const STRATEGIES: readonly Strategy[] = ['supersede', 'versioned_transfer', 'weighted_decay']

export function assertStrategy(value: unknown): Strategy {
  if (typeof value !== 'string' || !STRATEGIES.includes(value as Strategy)) {
    throw new CamlError('ERR-CONF-003', `未知策略：${String(value)}；可选值 ${STRATEGIES.join(' / ')}`)
  }
  return value as Strategy
}

export function parseIso(value: unknown, field: string): number {
  if (typeof value !== 'string') {
    throw new CamlError('ERR-INPUT-002', `${field} 必须是带时区的 ISO-8601 字符串`)
  }
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new CamlError('ERR-INPUT-003', `${field} 必须是带时区的 ISO-8601 字符串`)
  }
  return ms
}

export function optionalIso(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : parseIso(value, field)
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function assertLimit(value: unknown): number {
  if (value === undefined) return 20
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new CamlError('ERR-INPUT-009', 'limit 必须是 1–100 的整数')
  }
  return value
}

export function assertAuditLimit(value: unknown): number {
  if (value === undefined) return 100
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 200) {
    throw new CamlError('ERR-INPUT-009', 'audit 的 limit 必须是 1–200 的整数')
  }
  return value
}

export function optionalMinWeight(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new CamlError('ERR-INPUT-009', 'minWeight 必须在 0–1 之间')
  }
  return value
}

export function optionalQuery(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const length = Array.from(String(value)).length
  if (typeof value !== 'string' || length < 1 || length > 200) {
    throw new CamlError('ERR-INPUT-010', 'query 长度为 1–200 字符')
  }
  return value
}

export function assertMetadataSize(value: unknown, maxBytes: number): void {
  if (value === undefined) return
  let size: number
  try {
    size = Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    throw new CamlError('ERR-INT-002', 'metadata 含无法序列化的值')
  }
  if (size > maxBytes) {
    throw new CamlError('ERR-INPUT-005', `metadata 超过 ${maxBytes} 字节`)
  }
}
