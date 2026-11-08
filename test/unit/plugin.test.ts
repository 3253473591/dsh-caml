import { test } from 'node:test'
import assert from 'node:assert/strict'

import { name, apply } from '../../src/plugin.js'
import * as entry from '../../src/index.js'

test('plugin exposes the stable name and an apply function', () => {
  assert.equal(name, 'dsh-caml')
  assert.equal(typeof apply, 'function')
})

import { renderRecall } from '../../src/tools/render.js'

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
