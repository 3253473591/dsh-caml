import { CamlError } from '../errors.js'
import { normalizeText } from './normalize.js'

export const MAX_SUBJECT_CHARS = 200
export const MAX_PREDICATE_CHARS = 64
export const MAX_OBJECT_CHARS = 2000

export const PREDICATE_PATTERN = /^[\p{L}][\p{L}\p{N}_.-]{0,63}$/u

const codePoints = (value: string): number => Array.from(value).length

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new CamlError('ERR-INPUT-002', `${field} 必须是字符串`)
  }
  return value
}

export function assertSubject(value: unknown, max = MAX_SUBJECT_CHARS): string {
  const normalized = normalizeText(requireString(value, 'subject'))
  if (normalized === '') {
    throw new CamlError('ERR-INPUT-008', 'subject 归一化后为空')
  }
  if (codePoints(normalized) > max) {
    throw new CamlError('ERR-INPUT-005', `subject 超过 ${max} 字符（当前 ${codePoints(normalized)}）`)
  }
  return normalized
}

export function assertPredicate(value: unknown): string {
  const normalized = normalizeText(requireString(value, 'predicate'))
  if (!PREDICATE_PATTERN.test(normalized)) {
    throw new CamlError(
      'ERR-INPUT-007',
      'predicate 只能由字母/数字/_/./- 组成，且以字母开头（最多 64 个字符）',
    )
  }
  return normalized
}

export function assertObject(value: unknown, max = MAX_OBJECT_CHARS): string {
  const normalized = normalizeText(requireString(value, 'object'))
  if (normalized === '') {
    throw new CamlError('ERR-INPUT-008', 'object 归一化后为空')
  }
  if (codePoints(normalized) > max) {
    throw new CamlError('ERR-INPUT-005', `object 超过 ${max} 字符（当前 ${codePoints(normalized)}）`)
  }
  return normalized
}
