import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planAdjudication } from '../../src/domain/adjudicator.js'
import type { Fact } from '../../src/domain/types.js'
import { CamlError } from '../../src/errors.js'

const fact = (overrides: Partial<Fact> = {}): Fact => ({
  id: 'f_old',
  subject: '我',
  predicate: '目标城市',
  object: '杭州',
  status: 'active',
  weight: 1,
  validFrom: 1_000,
  validUntil: null,
  supersededBy: null,
  createdAt: 1_000,
  sourceSession: null,
  metadata: null,
  ...overrides,
})

const incoming = {
  subject: '我',
  predicate: '目标城市',
  object: '上海',
  observedAt: 2_000,
}

test('supersede closes the current fact, inserts a new active one and links them', () => {
  const plan = planAdjudication({
    current: [fact()],
    incoming,
    strategy: 'supersede',
    now: 3_000,
    newFactId: 'f_new',
    newAdjudicationId: 'a_1',
  })

  assert.equal(plan.insert.id, 'f_new')
  assert.equal(plan.insert.status, 'active')
  assert.equal(plan.insert.validFrom, 2_000)
  assert.deepEqual(plan.close, [
    { id: 'f_old', validUntil: 2_000, status: 'superseded', supersededBy: 'f_new' },
  ])
  assert.deepEqual(plan.relations, [
    { fromFactId: 'f_new', toFactId: 'f_old', relationType: 'SUPERSEDES' },
  ])
  assert.equal(plan.log.chosenStrategy, 'supersede')
  assert.deepEqual(plan.log.conflictFactIds, ['f_old'])
  assert.equal(plan.log.resultFactId, 'f_new')
  assert.equal(plan.log.reason, 'new_value')
})

test('one write with several current facts still yields one log row', () => {
  const plan = planAdjudication({
    current: [fact(), fact({ id: 'f_old2', object: '北京', validFrom: 1_500 })],
    incoming,
    strategy: 'supersede',
    now: 3_000,
    newFactId: 'f_new',
    newAdjudicationId: 'a_1',
  })

  assert.equal(plan.close.length, 2)
  assert.equal(plan.relations.length, 2)
  assert.deepEqual(plan.log.conflictFactIds, ['f_old', 'f_old2'])
})

test('weighted decay is not implemented yet', () => {
  assert.throws(
    () => planAdjudication({
      current: [fact()],
      incoming,
      strategy: 'weighted_decay',
      now: 3_000,
      newFactId: 'f_new',
      newAdjudicationId: 'a_1',
    }),
    (error: unknown) => error instanceof CamlError && error.code === 'ERR-INT-001',
  )
})
