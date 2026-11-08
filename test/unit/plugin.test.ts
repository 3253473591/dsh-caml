import { test } from 'node:test'
import assert from 'node:assert/strict'

import { name, apply } from '../../src/plugin.js'
import * as entry from '../../src/index.js'

test('plugin exposes the stable name and an apply function', () => {
  assert.equal(name, 'dsh-caml')
  assert.equal(typeof apply, 'function')
})

import { renderAudit, renderRecall } from '../../src/tools/render.js'

test('audit render lists every timeline entry, not just the summary', () => {
  const blocks = renderAudit({}, {
    subject: '项目',
    predicate: '负责人',
    summary: { versions: 2, current: { object: '李四' } },
    timeline: [
      { object: '张三', status: 'superseded', validFrom: '2026-09-01T00:00:00.000Z', validUntil: '2026-10-15T00:00:00.000Z' },
      { object: '李四', status: 'active', validFrom: '2026-10-15T00:00:00.000Z', validUntil: null },
    ],
  })
  const text = blocks.map((block) => block.text).join('\n')
  assert.ok(text.includes('张三'))
  assert.ok(text.includes('superseded'))
  assert.ok(text.includes('李四'))
})

test('render follows the DSH contract (args, value) -> ContentBlock[]', () => {
  const blocks = renderRecall({ subject: '我' }, { facts: [], truncated: false })
  assert.ok(Array.isArray(blocks))
  assert.equal(blocks[0]?.type, 'text')
  assert.equal(typeof blocks[0]?.text, 'string')
})

test('the package entry re-exports inject so Cordis can resolve ctx.tools', () => {
  assert.deepEqual(entry.inject, ['tools'])
  assert.equal(entry.name, 'dsh-caml')
  assert.equal(typeof entry.apply, 'function')
})
