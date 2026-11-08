import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeText, objectKey } from '../../src/domain/normalize.js'
import { assertSubject, assertPredicate, assertObject } from '../../src/domain/validate.js'
import { newFactId, newAdjudicationId } from '../../src/domain/id.js'
import { CamlError } from '../../src/errors.js'

const code = (fn: () => unknown): string => {
  try {
    fn()
    return 'NO_ERROR'
  } catch (error) {
    return error instanceof CamlError ? error.code : 'NON_CAML_ERROR'
  }
}

test('normalization folds width, collapses whitespace and trims', () => {
  assert.equal(normalizeText('ＡＢＣ'), 'ABC')
  assert.equal(normalizeText('  上海  '), '上海')
  assert.equal(normalizeText('a   b\tc'), 'a b c')
  assert.equal(normalizeText('　上海　'), '上海')
})

test('object comparison key is case-insensitive but the stored object keeps its case', () => {
  assert.equal(objectKey('Shanghai'), objectKey('shanghai'))
  assert.equal(normalizeText('Shanghai'), 'Shanghai')
})

test('subject keeps original case and rejects blank input', () => {
  assert.equal(assertSubject('  Zhang  San '), 'Zhang San')
  assert.equal(code(() => assertSubject('   ')), 'ERR-INPUT-008')
  assert.equal(code(() => assertSubject(42)), 'ERR-INPUT-002')
})

test('predicate accepts CJK letters and rejects spaces or a leading digit', () => {
  assert.equal(assertPredicate('目标城市'), '目标城市')
  assert.equal(assertPredicate('a.b-c_1'), 'a.b-c_1')
  assert.equal(code(() => assertPredicate('目标 城市')), 'ERR-INPUT-007')
  assert.equal(code(() => assertPredicate('1abc')), 'ERR-INPUT-007')
  assert.equal(code(() => assertPredicate('/x')), 'ERR-INPUT-007')
})

test('length limits count code points, not UTF-16 units', () => {
  const family = '👨‍👩‍👧'
  assert.equal(assertObject(family, 5), family)
  assert.equal(code(() => assertObject(family, 4)), 'ERR-INPUT-005')
  assert.equal(code(() => assertObject('   ', 100)), 'ERR-INPUT-008')
})

test('ids carry stable prefixes, are unique and sort by creation time', () => {
  const early = newFactId(1_000)
  const late = newFactId(2_000)
  assert.ok(early.startsWith('f_'))
  assert.ok(newAdjudicationId(1_000).startsWith('a_'))
  assert.ok(early < late)
  assert.equal(new Set(Array.from({ length: 500 }, () => newFactId())).size, 500)
})
