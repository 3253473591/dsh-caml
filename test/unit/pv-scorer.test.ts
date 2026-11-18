import { test } from 'node:test'
import assert from 'node:assert/strict'

import { scoreRecord, type PvCase, type RecordedRun } from '../../eval/pv.js'

const baseCase: PvCase = {
  id: 'PV-01-direct',
  suite: 'pv',
  scenario: '01-目标城市',
  promptClass: 'direct',
  session: 'fresh',
  prompt: '我现在想去哪个城市？',
  expect: {
    mustCall: ['caml-recall'],
    mustNotCall: ['caml-remember', 'caml-audit'],
    args: { subject: '我', predicate: '目标城市' },
    mustMention: ['上海'],
    mustNotMentionAsCurrent: ['杭州'],
  },
}

const record = (overrides: Partial<RecordedRun> = {}): RecordedRun => ({
  id: baseCase.id,
  toolCalls: [{ name: 'caml-recall', args: { subject: '我', predicate: '目标城市' } }],
  answer: '你现在想去上海。',
  ...overrides,
})

test('a correct run scores tools and answer', () => {
  const score = scoreRecord(baseCase, record())
  assert.equal(score.toolsHit, true)
  assert.equal(score.falseTrigger, false)
  assert.equal(score.answerCorrect, true)
  assert.equal(score.staleLeak, false)
})

test('missing the required tool fails the hit rate', () => {
  const score = scoreRecord(baseCase, record({ toolCalls: [] }))
  assert.equal(score.toolsHit, false)
})

test('wrong arguments fail the hit rate', () => {
  const score = scoreRecord(baseCase, record({
    toolCalls: [{ name: 'caml-recall', args: { subject: '我', predicate: '目标岗位' } }],
  }))
  assert.equal(score.toolsHit, false)
})

test('calling a forbidden tool counts as a false trigger', () => {
  const absent: PvCase = {
    ...baseCase,
    id: 'PV-04-absent',
    promptClass: 'absent',
    prompt: '帮我写个快排。',
    expect: {
      mustCall: [],
      mustNotCall: ['caml-recall', 'caml-audit', 'caml-remember'],
      mustMention: [],
      mustNotMentionAsCurrent: [],
    },
  }
  const score = scoreRecord(absent, record({ toolCalls: [{ name: 'caml-recall' }], answer: '好的。' }))
  assert.equal(score.falseTrigger, true)
})

test('a stale-only answer leaks history and fails the answer', () => {
  const score = scoreRecord(baseCase, record({ answer: '你的目标城市是杭州。' }))
  assert.equal(score.staleLeak, true)
  assert.equal(score.answerCorrect, false)
})

test('mentioning both values defers the answer to a human', () => {
  const score = scoreRecord(baseCase, record({ answer: '现在是上海，之前是杭州。' }))
  assert.equal(score.answerCorrect, null)
  assert.ok(score.notes.some((note) => note.includes('both')))
})
