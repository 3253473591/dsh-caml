import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { apply } from '../../src/plugin.js'
import { resolveConfig } from '../../src/config.js'
import { CamlError } from '../../src/errors.js'
import { createFakeCtx } from '../harness/ctx.js'

const withTempDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'caml-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const isCaml = (code: string) => (error: unknown): boolean =>
  error instanceof CamlError && error.code === code

test('apply registers the three caml tools and dispose removes them', async () => {
  await withTempDir(async (dir) => {
    const { ctx, tools } = createFakeCtx()
    const dispose = await apply(ctx, { storage: { dbPath: join(dir, 'caml.db') } })
    assert.deepEqual([...tools.keys()].sort(), ['caml-audit', 'caml-recall', 'caml-remember'])
    dispose()
    assert.equal(tools.size, 0)
  })
})

test('apply rejects with ERR-STORE-001 when the database path cannot be opened', async () => {
  await withTempDir(async (dir) => {
    const { ctx } = createFakeCtx()
    await assert.rejects(apply(ctx, { storage: { dbPath: dir } }), isCaml('ERR-STORE-001'))
  })
})

test('audit returns the empty-coordinate contract', async () => {
  await withTempDir(async (dir) => {
    const { ctx, tools } = createFakeCtx()
    const dispose = await apply(ctx, { storage: { dbPath: join(dir, 'caml.db') } })
    const audit = tools.get('caml-audit')
    assert.ok(audit)
    const result = await audit.execute({ subject: '我', predicate: '目标城市' }) as {
      timeline: unknown[]
      summary: { current: unknown; versions: number }
    }
    assert.deepEqual(result.timeline, [])
    assert.equal(result.summary.current, null)
    assert.equal(result.summary.versions, 0)
    dispose()
  })
})

test('audit tool returns ISO timestamps, version count and adjudications', async () => {
  await withTempDir(async (dir) => {
    const { ctx, tools } = createFakeCtx()
    const dispose = await apply(ctx, { storage: { dbPath: join(dir, 'caml.db') } })
    const remember = tools.get('caml-remember')
    const audit = tools.get('caml-audit')
    assert.ok(remember && audit)

    await remember.execute({
      subject: '我', predicate: '目标城市', object: '杭州', observedAt: '2026-01-01T00:00:00Z',
    })
    await remember.execute({
      subject: '我', predicate: '目标城市', object: '上海', observedAt: '2026-02-01T00:00:00Z',
    })

    const result = await audit.execute({ subject: '我', predicate: '目标城市' }) as {
      summary: { versions: number; current: { object: string } | null }
      timeline: Array<{ validFrom: string }>
      adjudications: unknown[]
    }
    assert.equal(result.summary.versions, 2)
    assert.equal(result.summary.current?.object, '上海')
    assert.equal(typeof result.timeline[0]?.validFrom, 'string')
    assert.equal(result.adjudications.length, 1)
    dispose()
  })
})

test('resolveConfig defaults under DSH_HOME and resolves relative paths against cwd', () => {
  const defaults = resolveConfig(undefined, { cwd: resolve('/work'), dshHome: resolve('/home/u/.dsh') })
  assert.equal(defaults.dbPath, join(resolve('/home/u/.dsh'), 'caml', 'caml.db'))

  const relative = resolveConfig({ storage: { dbPath: 'data/x.db' } }, { cwd: resolve('/work') })
  assert.equal(relative.dbPath, join(resolve('/work'), 'data', 'x.db'))

  const absolute = resolveConfig({ storage: { dbPath: resolve('/abs/x.db') } }, { cwd: resolve('/work') })
  assert.equal(absolute.dbPath, resolve('/abs/x.db'))
})

test('invalid strategy names fail with ERR-CONF-003', () => {
  assert.throws(
    () => resolveConfig({ strategies: { default: 'foo' } }, { cwd: resolve('/work') }),
    isCaml('ERR-CONF-003'),
  )
})
