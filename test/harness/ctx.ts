/** Minimal Cordis ctx double: records tool registrations and their disposers. */

export interface FakeTool {
  name: string
  description: string
  parameters: unknown
  output: { schema: unknown; render: (value: unknown) => string }
  execute: (args: unknown) => Promise<unknown>
}

export interface FakeCtx {
  tools: {
    register: (tool: FakeTool) => () => void
  }
  get: (name: string) => unknown
}

export function createFakeCtx(): { ctx: FakeCtx; tools: Map<string, FakeTool> } {
  const tools = new Map<string, FakeTool>()
  const ctx: FakeCtx = {
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => {
          tools.delete(tool.name)
        }
      },
    },
    get: () => undefined,
  }
  return { ctx, tools }
}
