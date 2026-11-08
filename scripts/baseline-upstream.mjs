import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Drive the upstream plugin (AieXile/dsh-memory-plugin@1.6.0) with a fake ctx,
// exactly the shape its own test/host-harness.mjs uses.
const upstreamDir = resolve(process.argv[2] ?? '.tmp/base')
const host = await import(pathToFileURL(join(upstreamDir, 'lib', 'host.js')).href)

const work = await mkdtemp(join(tmpdir(), 'caml-baseline-'))
const session = {
  id: 'sess-baseline',
  header: { version: 3, id: 'sess-baseline', cwd: work, createdAt: 0, isSeeded: false },
  requestHeader() { return { config: { provider: 'fake', model: 'fake-model' } } },
}
const agents = {
  currentInitiator() { return { session } },
  roots() { return [{ session }] },
  get() { return { session } },
}
const policy = {
  defaultMode: 'workspace-write',
  workspaceRoot: work,
  resolve() { return { mode: 'danger-full-access', workspaceRoot: work } },
}

const tools = new Map()
const ctx = {
  get(name) {
    if (name === 'sandboxPolicy') return policy
    if (name === 'agents') return agents
    return undefined
  },
  on() { return () => {} },
  fs: {
    async resolve(path) { return { path } },
    async stat(target) { try { const info = await stat(target.path); return { path: target.path, size: info.size } } catch { return undefined } },
    async readText(target) { return await readFile(target.path, 'utf8') },
    async writeText(target, content) { await mkdir(join(target.path, '..'), { recursive: true }); await writeFile(target.path, content, 'utf8') },
  },
  systemPrompt: { section() { return () => {} } },
  tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
  webServer: { register() { return () => {} } },
}

await host.apply(ctx)

const add = (content) => tools.get('memory_add').execute({ content, type: 'project' })
const search = (query) => tools.get('memory_search').execute({ query, limit: 10 })

const scenarios = [
  ['求职-城市', '我 目标城市 杭州', '我 目标城市 上海', '目标城市'],
  ['求职-岗位', '我 目标岗位 后端', '我 目标岗位 数据工程', '目标岗位'],
  ['求职-雇主', '我 当前雇主 甲公司', '我 当前雇主 乙公司', '当前雇主'],
  ['求职-薪资', '我 期望薪资 15k', '我 期望薪资 20k', '期望薪资'],
  ['求职-三连', '我 目标城市 A', '我 目标城市 C', '目标城市'],
  ['求职-改回', '我 目标城市 杭州', '我 目标城市 杭州', '目标城市'],
  ['企业-负责人', '支付项目 负责人 张三', '支付项目 负责人 李四', '支付项目'],
  ['企业-值班', '服务 值班人 王五', '服务 值班人 赵六', '值班'],
  ['企业-审批', '预算 审批人 甲', '预算 审批人 乙', '审批'],
  ['企业-三任', '项目 负责人 甲', '项目 负责人 丙', '项目'],
  ['企业-回查', '项目 负责人 张三', '项目 负责人 李四', '项目'],
  ['旅游-住宿', '我 住宿偏好 青旅', '我 住宿偏好 酒店', '住宿'],
  ['旅游-漂移', '我 住宿偏好 青旅', '我 住宿偏好 民宿', '住宿'],
  ['旅游-交通', '我 交通偏好 火车', '我 交通偏好 自驾', '交通'],
  ['旅游-餐饮', '我 餐饮偏好 辣', '我 餐饮偏好 素食', '餐饮'],
  ['旅游-混合', '我 住宿偏好 青旅', '我 住宿偏好 民宿', '偏好'],
]

const cases = []
for (const [id, oldText, newText, keyword] of scenarios) {
  await add(oldText)
  await add(newText)
  const raw = await search(keyword)
  const text = JSON.stringify(raw)
  const hasOld = text.includes(oldText)
  const hasNew = text.includes(newText)
  const ambiguous = hasOld && hasNew
  cases.push({
    id,
    keyword,
    resultContainsNew: hasNew,
    resultContainsOld: hasOld,
    currentValueCorrect: hasNew && !hasOld,
    historyAnswerable: false,
    note: ambiguous ? 'both values returned as current' : 'see raw',
  })
}

const report = {
  environment: {
    upstream: 'AieXile/dsh-memory-plugin@1.6.0',
    upstreamTestedDsh: '0.1.7-rc.2',
    harness: 'fake Cordis ctx (same shape as upstream test/host-harness.mjs)',
    node: process.version,
    platform: process.platform,
    workdir: work,
  },
  command: `node scripts/baseline-upstream.mjs ${upstreamDir}`,
  metrics: {
    currentValueCorrect: cases.filter((entry) => entry.currentValueCorrect).length,
    historyAnswerable: cases.filter((entry) => entry.historyAnswerable).length,
    total: cases.length,
  },
  note: 'currentValueCorrect = result contains new value and not the stale one; historyAnswerable = a tool can return the old value as history (upstream has no timeline).',
  cases,
}

const outPath = resolve(process.argv[3] ?? 'eval/baseline.json')
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report.metrics))
console.log(`written ${outPath}`)
