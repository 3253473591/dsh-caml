# ADR-0003 · 项目结构

> 状态：已接受 ｜ 日期：2026-11-08 ｜ 决策者：项目作者 ｜ 影响：[03 数据](./../03-data-model.md)、[06 测试](./../06-test-plan.md)

## 背景

底座是单文件 `lib/host.js`（约千行，存储/工具/路由/面板混在一起）。若照搬，裁决逻辑会与 SQL 拼接、参数解析、渲染纠缠，无法单测，也无法在面试中讲清边界。需要一次**只拆结构、不改行为**的重组。

## 决定

```
dsh-caml/
├─ package.json            # name: dsh-caml；dsh.bundle；exports；零 dependencies
├─ cordis.patch.yml        # 一行 entry
├─ tsconfig.json           # strict, ESM, outDir lib
├─ src/
│  ├─ plugin.ts            # apply()：读配置 → 开库 → 注册工具 → disposer
│  ├─ config.ts            # 配置 schema + 校验（ERR-CONF-*）
│  ├─ domain/              # 纯函数，零 IO，零 import 外部模块
│  │  ├─ types.ts          # Fact / FactView / Strategy / AdjudicationPlan
│  │  ├─ normalize.ts      # NFKC / 折叠 / casefold
│  │  ├─ validate.ts       # 长度、正则、时间
│  │  ├─ id.ts             # f_ / a_ 生成
│  │  └─ adjudicator.ts    # (旧事实, 新事实, 策略) → 迁移计划（不执行）
│  ├─ store/
│  │  ├─ port.ts           # FactStore 接口（remember/recall/audit/close）
│  │  ├─ sqlite.ts         # 实现：事务、查询、重试
│  │  ├─ schema.ts         # DDL + user_version
│  │  └─ migrate.ts
│  └─ tools/
│     ├─ remember.ts       # 参数校验 → 领域 → store → 视图
│     ├─ recall.ts
│     ├─ audit.ts
│     └─ render.ts         # 人读渲染（不含语义）
├─ test/
│  ├─ harness/             # 假 ctx、可注入时钟
│  ├─ unit/  integration/  property/  fault/
├─ eval/
│  ├─ cases/*.json
│  ├─ run.ts
│  └─ report/
└─ docs/                   # 本设计文档集
```

## 依赖方向（硬规则）

```
domain  ←  store  ←  tools  ←  plugin
   ↑__________↑________↑
        （只能向左依赖）
```

| 规则 | 强制方式 |
|---|---|
| `domain/` 不 import `node:fs`/`node:sqlite`/`store`/`tools` | ESLint `no-restricted-imports` + TC 前置检查 |
| `store/` 不 import `tools/`，不渲染文本 | 同上 |
| `tools/` 不含 SQL、不含状态迁移决策 | 代码审查 + 单测只 mock `FactStore` |
| `plugin.ts` 是唯一读配置、开库、注册工具的地方 | 代码审查 |

## 关键接口（形态）

```ts
// store/port.ts —— 裁决的"计划"由 domain 产出，store 只负责在一个事务里执行
interface FactStore {
  readonly current: (subject: string, predicate: string) => Fact[]
  readonly remember: (plan: AdjudicationPlan) => Promise<RememberResult>
  readonly recall: (query: RecallQuery) => FactView[]
  readonly audit: (subject: string, predicate: string) => AuditResult
  readonly close: () => Promise<void>
}
```

- `AdjudicationPlan` 是纯数据：要关闭哪些、插入什么、建哪些关系、写什么日志。
- 这样"决策"可单测（无 IO），"执行"可故障注入（可回滚）。

## 选项

| 方案 | 判定 |
|---|---|
| 保留单文件，内部用注释分段 | ❌ 无法强制依赖方向；单测要起库 |
| 拆成 `packages/*` monorepo | ❌ 一个插件拆多包会触发 DSH 的"一个包名一个解析源"限制，徒增成本 |
| 四层目录（采纳） | ✅ 边界可讲、可测；与 ADR-0002 的"零依赖"一致 |

## 后果

- 文件更多，但每个文件职责单一；评审可只读 `domain/adjudicator.ts` 就理解语义。
- 需要维护一份 `FactStore` 接口；未来换后端只改 `store/sqlite.ts`。
- 构建产物 `lib/` 只含 JS + `.d.ts`，`files` 白名单发布。

## 何时重审

- 需要多个后端（如 memory / sqlite）同时存在。
- 需要把 `domain/` 抽成独立 npm 包供其他插件复用（当前不做）。
