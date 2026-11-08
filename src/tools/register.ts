import type { CamlConfig } from '../config.js'
import type { FactStore } from '../store/port.js'
import { makeAuditTool } from './audit.js'
import { makeRecallTool } from './recall.js'
import { makeRememberTool } from './remember.js'

export interface ToolRegistration {
  name: string
  description: string
  parameters: unknown
  output: { schema: unknown; render: (value: unknown) => string }
  execute: (args: unknown) => Promise<unknown>
}

export interface ToolsCtx {
  tools: {
    register: (tool: ToolRegistration) => () => void
  }
}

export function registerTools(ctx: ToolsCtx, store: FactStore, config: CamlConfig): Array<() => void> {
  const tools = [
    makeRememberTool(store, config),
    makeRecallTool(store, config),
    makeAuditTool(store),
  ]
  return tools.map((tool) => ctx.tools.register(tool))
}
