import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assertLimit, optionalQuery } from '../../src/tools/common.js'
import { CamlError } from '../../src/errors.js'

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
    return 'NO_ERROR'
  } catch (error) {
    return error instanceof CamlError ? error.code : 'NON_CAML_ERROR'
  }
}

test('limit must be an integer in 1..100', () => {
  assert.equal(assertLimit(undefined), 20)
  assert.equal(assertLimit(5), 5)
  assert.equal(codeOf(() => assertLimit(0)), 'ERR-INPUT-009')
  assert.equal(codeOf(() => assertLimit(101)), 'ERR-INPUT-009')
  assert.equal(codeOf(() => assertLimit(1.5)), 'ERR-INPUT-009')
})

test('query length is bounded by 1..200 characters', () => {
  assert.equal(optionalQuery(undefined), undefined)
  assert.equal(optionalQuery('pnpm'), 'pnpm')
  assert.equal(codeOf(() => optionalQuery('')), 'ERR-INPUT-010')
  assert.equal(codeOf(() => optionalQuery('x'.repeat(201))), 'ERR-INPUT-010')
})
