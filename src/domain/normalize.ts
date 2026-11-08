/** Text normalization shared by every write and lookup path. */

export function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

export function normalizeSubject(value: string): string {
  return normalizeText(value)
}

export function normalizeObject(value: string): string {
  return normalizeText(value)
}

/** Comparison key for objects: normalization plus case folding. */
export function objectKey(value: string): string {
  return normalizeText(value).toLowerCase()
}
