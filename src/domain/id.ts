import { randomUUID } from 'node:crypto'

const randomSuffix = (): string => randomUUID().replaceAll('-', '').slice(0, 10)

const timePrefix = (now: number): string => now.toString(36).padStart(9, '0')

/** Fact id: `f_<time36>_<random10>`. Opaque; lexicographic order roughly follows creation. */
export function newFactId(now = Date.now()): string {
  return `f_${timePrefix(now)}_${randomSuffix()}`
}

/** Adjudication id: `a_<time36>_<random10>`. */
export function newAdjudicationId(now = Date.now()): string {
  return `a_${timePrefix(now)}_${randomSuffix()}`
}
