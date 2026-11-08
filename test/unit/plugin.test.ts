import { test } from 'node:test'
import assert from 'node:assert/strict'

import { name, apply } from '../../src/plugin.js'
import * as entry from '../../src/index.js'

test('plugin exposes the stable name and an apply function', () => {
  assert.equal(name, 'dsh-caml')
  assert.equal(typeof apply, 'function')
})

test('the package entry re-exports inject so Cordis can resolve ctx.tools', () => {
  assert.deepEqual(entry.inject, ['tools'])
  assert.equal(entry.name, 'dsh-caml')
  assert.equal(typeof entry.apply, 'function')
})
