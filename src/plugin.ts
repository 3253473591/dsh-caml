import { resolveConfig } from './config.js'
import { openStore } from './store/sqlite.js'
import { registerTools, type ToolsCtx } from './tools/register.js'

/**
 * Cordis plugin entry.
 *
 * `inject` is the real host requirement; the fake ctx used by tests does not
 * enforce it. The optional second argument exists so tests (and later the
 * profile patch) can pass a config object without a host config service.
 */
export const name = 'dsh-caml'
export const inject = ['tools']

export async function apply(ctx: unknown, rawConfig?: unknown): Promise<() => void> {
  const config = resolveConfig(rawConfig)
  const store = await openStore(config.dbPath)

  try {
    const disposers = registerTools(ctx as ToolsCtx, store, config)
    return () => {
      for (const dispose of disposers) dispose()
      void store.close()
    }
  } catch (error) {
    await store.close()
    throw error
  }
}
