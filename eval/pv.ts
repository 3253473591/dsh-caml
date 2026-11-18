/**
 * PV/AB evaluation runner.
 *
 * - `emit` writes eval/pv-cases.json (64 PV + 32 AB) from the fixed scenario table.
 * - `score <records.json>` scores recorded model runs (tool calls + answer).
 *
 * The runner never calls a model: records come from real UI probes, and any
 * ambiguous answer is deferred to a human via `answerCorrect: null`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export type PromptClass = 'direct' | 'indirect' | 'contradict' | 'absent'
export type SessionMode = 'same' | 'fresh'

export interface FactSeed {
  subject: string
  predicate: string
  object: string
  observedAt: string
}

export interface PvExpectation {
  mustCall: string[]
  mustNotCall: string[]
  args?: Record<string, string>
  mustMention: string[]
  mustNotMentionAsCurrent: string[]
}

export interface PvCase {
  id: string
  suite: 'pv' | 'ab'
  scenario: string
  promptClass: PromptClass
  session: SessionMode
  prompt: string
  given: FactSeed[]
  expect: PvExpectation
}

export interface RecordedRun {
  id: string
  toolCalls: Array<{ name: string; args?: Record<string, unknown> }>
  answer: string
}

export interface Score {
  id: string
  toolsHit: boolean
  falseTrigger: boolean
  answerCorrect: boolean | null
  staleLeak: boolean
  notes: string[]
}

interface Scenario {
  id: string
  domain: '求职' | '企业' | '旅游'
  subject: string
  predicate: string
  strategy: 'supersede' | 'versioned_transfer' | 'weighted_decay'
  old: string
  next: string
  prompts: Record<PromptClass, string>
}

const OLD_AT = '2026-10-01T00:00:00Z'
const NEW_AT = '2026-11-01T00:00:00Z'

const scenarios: Scenario[] = [
  { id: '01', domain: '求职', subject: '我', predicate: '目标城市', strategy: 'supersede', old: '杭州', next: '上海', prompts: { direct: '我现在想去哪个城市？', indirect: '下周去面试，通勤怎么安排？', contradict: '我记得是杭州吧？', absent: '帮我写个快排。' } },
  { id: '02', domain: '求职', subject: '我', predicate: '目标岗位', strategy: 'supersede', old: '后端', next: '数据工程', prompts: { direct: '我现在的目标岗位是什么？', indirect: '帮我按目标岗位准备面试题', contradict: '我不是想做后端吗？', absent: '推荐一部科幻电影。' } },
  { id: '03', domain: '求职', subject: '我', predicate: '当前雇主', strategy: 'supersede', old: '甲公司', next: '乙公司', prompts: { direct: '我现在在哪家公司？', indirect: '帮我写一段给现在雇主的请假邮件', contradict: '我不是在甲公司吗？', absent: '今天天气怎么样？' } },
  { id: '04', domain: '求职', subject: '我', predicate: '期望薪资', strategy: 'supersede', old: '15k', next: '20k', prompts: { direct: '我的期望薪资是多少？', indirect: '帮我评估这个 offer 够不够', contradict: '我记得是 15k？', absent: '解释 HTTP 和 HTTPS 的区别。' } },
  { id: '05', domain: '求职', subject: '我', predicate: '目标行业', strategy: 'supersede', old: '互联网', next: '新能源', prompts: { direct: '我想去哪个行业？', indirect: '帮我看看这个行业的公司', contradict: '我不是想去互联网吗？', absent: '写一个二分查找。' } },
  { id: '06', domain: '求职', subject: '我', predicate: '目标城市', strategy: 'supersede', old: '上海', next: '杭州', prompts: { direct: '我现在想去哪个城市？', indirect: '按我现在想去的城市推荐租房区域', contradict: '我记得是上海？', absent: '讲个笑话。' } },
  { id: '07', domain: '企业', subject: '支付项目', predicate: '负责人', strategy: 'versioned_transfer', old: '张三', next: '李四', prompts: { direct: '支付项目现在谁负责？', indirect: '支付项目要上线，我该找谁？', contradict: '负责人不是张三吗？', absent: '帮我画个流程图。' } },
  { id: '08', domain: '企业', subject: '服务', predicate: '值班人', strategy: 'versioned_transfer', old: '王五', next: '赵六', prompts: { direct: '现在谁值班？', indirect: '线上报警了，找谁？', contradict: '不是王五吗？', absent: '总结一下这段日志。' } },
  { id: '09', domain: '企业', subject: '预算', predicate: '审批人', strategy: 'versioned_transfer', old: '甲', next: '乙', prompts: { direct: '预算现在谁审批？', indirect: '这笔预算该走谁的审批？', contradict: '审批人不是甲吗？', absent: '写个正则匹配邮箱。' } },
  { id: '10', domain: '企业', subject: '项目', predicate: '负责人', strategy: 'versioned_transfer', old: '甲', next: '丙', prompts: { direct: '项目现在谁负责？', indirect: '项目交接给谁了？', contradict: '我记得是乙？', absent: '把这句话翻译成英文。' } },
  { id: '11', domain: '企业', subject: '项目', predicate: '负责人', strategy: 'versioned_transfer', old: '张三', next: '李四', prompts: { direct: '项目现在谁负责？之前是谁？', indirect: '和上一任负责人对比一下', contradict: '之前不是李四吗？', absent: '帮我列个提纲。' } },
  { id: '12', domain: '旅游', subject: '我', predicate: '住宿偏好', strategy: 'weighted_decay', old: '青旅', next: '酒店', prompts: { direct: '我现在偏好住哪种？', indirect: '帮我订个符合我偏好的住处', contradict: '我不是喜欢青旅吗？', absent: '推荐三条徒步路线。' } },
  { id: '13', domain: '旅游', subject: '我', predicate: '交通偏好', strategy: 'weighted_decay', old: '火车', next: '自驾', prompts: { direct: '我现在偏好怎么出行？', indirect: '这个行程怎么安排交通？', contradict: '我不是坐火车吗？', absent: '比较一下两种相机。' } },
  { id: '14', domain: '旅游', subject: '我', predicate: '餐饮偏好', strategy: 'weighted_decay', old: '辣', next: '清淡', prompts: { direct: '我现在口味偏什么？', indirect: '按我的口味推荐餐厅', contradict: '我不是能吃辣吗？', absent: '解释一下光合作用。' } },
  { id: '15', domain: '旅游', subject: '我', predicate: '旅行目的地', strategy: 'weighted_decay', old: '云南', next: '新疆', prompts: { direct: '我下次想去哪？', indirect: '帮我做下个月的行程预算', contradict: '不是云南吗？', absent: '写一首五言绝句。' } },
  { id: '16', domain: '旅游', subject: '我', predicate: '旅行节奏', strategy: 'weighted_decay', old: '特种兵', next: '慢旅行', prompts: { direct: '我喜欢什么旅行节奏？', indirect: '帮我排一个五天的行程', contradict: '我不是喜欢特种兵式吗？', absent: '介绍一个历史人物。' } },
]

const given = (scenario: Scenario): FactSeed[] => [
  { subject: scenario.subject, predicate: scenario.predicate, object: scenario.old, observedAt: OLD_AT },
  { subject: scenario.subject, predicate: scenario.predicate, object: scenario.next, observedAt: NEW_AT },
]

const expectation = (scenario: Scenario, promptClass: PromptClass): PvExpectation => {
  if (promptClass === 'absent') {
    return {
      mustCall: [],
      mustNotCall: ['caml-recall', 'caml-audit', 'caml-remember'],
      mustMention: [],
      mustNotMentionAsCurrent: [],
    }
  }
  return {
    mustCall: ['caml-recall'],
    mustNotCall: ['caml-remember', 'caml-audit'],
    args: promptClass === 'contradict'
      ? { object: scenario.old }
      : { subject: scenario.subject, predicate: scenario.predicate },
    mustMention: [scenario.next],
    mustNotMentionAsCurrent: [scenario.old],
  }
}

export function buildCases(): PvCase[] {
  const cases: PvCase[] = []
  for (const scenario of scenarios) {
    for (const promptClass of ['direct', 'indirect', 'contradict', 'absent'] as PromptClass[]) {
      cases.push({
        id: `PV-${scenario.id}-${promptClass}`,
        suite: 'pv',
        scenario: `${scenario.id}-${scenario.predicate}`,
        promptClass,
        session: 'fresh',
        prompt: scenario.prompts[promptClass],
        given: promptClass === 'absent' ? [] : given(scenario),
        expect: expectation(scenario, promptClass),
      })
    }
    for (const session of ['same', 'fresh'] as SessionMode[]) {
      cases.push({
        id: `AB-${scenario.id}-${session}`,
        suite: 'ab',
        scenario: `${scenario.id}-${scenario.predicate}`,
        promptClass: 'direct',
        session,
        prompt: scenario.prompts.direct,
        given: given(scenario),
        expect: expectation(scenario, 'direct'),
      })
    }
  }
  return cases
}

const hasArgs = (actual: Record<string, unknown> | undefined, expected: Record<string, string> | undefined): boolean => {
  if (expected === undefined) return true
  if (actual === undefined) return false
  return Object.entries(expected).every(([key, value]) => actual[key] === value)
}

export function scoreRecord(testCase: PvCase, run: RecordedRun): Score {
  const notes: string[] = []
  const names = run.toolCalls.map((call) => call.name)

  const toolsHit = testCase.expect.mustCall.every((required) =>
    run.toolCalls.some((call) => call.name === required && hasArgs(call.args, testCase.expect.args)))
  const falseTrigger = names.some((name) => testCase.expect.mustNotCall.includes(name))

  const mentionsNew = testCase.expect.mustMention.every((value) => run.answer.includes(value))
  const mentionsOld = testCase.expect.mustNotMentionAsCurrent.some((value) => run.answer.includes(value))

  let answerCorrect: boolean | null = mentionsNew ? true : false
  let staleLeak = false
  if (mentionsOld && mentionsNew) {
    answerCorrect = null
    notes.push('both values mentioned; needs human review')
  } else if (mentionsOld && !mentionsNew) {
    staleLeak = true
    answerCorrect = false
  }
  if (testCase.expect.mustCall.length === 0 && mentionsNew) {
    answerCorrect = false
    notes.push('absent case should not assert facts')
  }

  return { id: testCase.id, toolsHit, falseTrigger, answerCorrect, staleLeak, notes }
}

export function scoreRun(cases: PvCase[], runs: RecordedRun[]): {
  total: number
  scored: number
  toolsHitRate: number
  falseTriggerRate: number
  staleLeakRate: number
  answerCorrectRate: number
  needsHuman: number
  missing: string[]
} {
  const byId = new Map(runs.map((run) => [run.id, run]))
  const scores: Score[] = []
  const missing: string[] = []
  for (const testCase of cases) {
    const run = byId.get(testCase.id)
    if (run === undefined) { missing.push(testCase.id); continue }
    scores.push(scoreRecord(testCase, run))
  }
  const ratio = (count: number): number => (scores.length === 0 ? 0 : Math.round((count / scores.length) * 1000) / 1000)
  return {
    total: cases.length,
    scored: scores.length,
    toolsHitRate: ratio(scores.filter((score) => score.toolsHit).length),
    falseTriggerRate: ratio(scores.filter((score) => score.falseTrigger).length),
    staleLeakRate: ratio(scores.filter((score) => score.staleLeak).length),
    answerCorrectRate: ratio(scores.filter((score) => score.answerCorrect === true).length),
    needsHuman: scores.filter((score) => score.answerCorrect === null).length,
    missing,
  }
}

const main = (): void => {
  const command = process.argv[2] ?? 'emit'
  if (command === 'emit') {
    const cases = buildCases()
    mkdirSync('eval', { recursive: true })
    writeFileSync('eval/pv-cases.json', `${JSON.stringify(cases, null, 2)}\n`)
    console.log(`wrote eval/pv-cases.json (${cases.filter((c) => c.suite === 'pv').length} PV, ${cases.filter((c) => c.suite === 'ab').length} AB)`)
    return
  }
  if (command === 'score') {
    const file = process.argv[3]
    if (file === undefined) { console.error('usage: pv.ts score <records.json>'); process.exit(1) }
    const runs = JSON.parse(readFileSync(file, 'utf8')) as RecordedRun[]
    const report = scoreRun(buildCases(), runs)
    mkdirSync('eval/report', { recursive: true })
    writeFileSync('eval/report/pv-report.json', `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.error('usage: pv.ts [emit|score <records.json>]')
  process.exit(1)
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/eval/pv.ts')) main()
