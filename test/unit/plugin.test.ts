import { test } from 'node:test'
import assert from 'node:assert/strict'

import { name, apply } from '../../src/plugin.js'

test('plugin exposes the stable name and an apply function', () => {
  assert.equal(name, 'dsh-caml')
  assert.equal(typeof apply, 'function')
})
