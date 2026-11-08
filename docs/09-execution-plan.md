# CAML 执行计划（M1–M5）

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans`（本会话内实现）或 `superpowers:subagent-driven-development`（每个任务换人）。步骤用 `- [ ]` 跟踪。
>
> 状态：待批准 ｜ 日期：2026-11-08 ｜ 适用：DSH `0.2.1-rc.2`

**Goal:** 把 [01 PRD](./01-prd.md) 的裁决契约落成一个可安装、可评测、可演示的 DSH 插件 `dsh-caml`。

**Architecture:** 四层单向依赖 `domain（纯函数）→ store（SQLite）→ tools（契约）→ plugin（装配）`；每次写入 = 一个事务里完成"关旧 + 插新 + 建关系 + 写日志"。

**Tech Stack:** TypeScript（strict）+ `node:sqlite` + `node:test`（经 `tsx` 运行）+ 零运行时依赖。

**Spec:** [01 PRD](./01-prd.md) · [02 API](./02-api-contract.md) · [03 数据](./03-data-model.md) · [04 异常](./04-errors-and-edge-cases.md) · [05 非功能](./05-non-functional.md) · [06 测试](./06-test-plan.md) · [07 验收](./07-acceptance.md) · [08 ADR](./08-decisions/README.md)

## Global Constraints

- Node `^22.19.0 || >=24.0.0`；`engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"`。
- `dependencies` 必须为空；不 import `http`/`https`/`fetch`；不引入 ORM/迁移框架。
- 工具名固定 `caml-remember` / `caml-recall` / `caml-audit`；包名 `dsh-caml`。
- 存储：`node:sqlite`，WAL，`STRICT` 表，`user_version = 1`；一进程一库、全会话共享。
- 时间入参 ISO-8601 带时区；内部 epoch ms；`observedAt` 必须严格晚于当前有效事实的 `valid_from`。
- 裁决过程零 LLM、零网络；历史行永不删除（[ADR-0004](./08-decisions/adr-0004-red-lines.md)）。
- 所有错误抛 `CamlError`（`code` 稳定），不返回 `{ok:false}`，不空吞异常。

## Review Focus

以下五类是规格能推出、但单条用例最容易漏掉、且错了会伤人输入；每条都在指定任务里有对应测试。

1. **同坐标并发写**：两个工具调用几乎同时写同一 `(subject,predicate)` → 必须"重试后一个成功、另一个 duplicate/裁决"，不得出现两条 active 或半写（T2.3，PT-1/FT-3）。
2. **归一化边界**：全角/半角、大小写、首尾与内部空白、emoji 组合字符 → 判等要稳定，长度按 code point（T1.2，TC-6）。
3. **时间边界**：`observedAt` 相等/未来/缺时区/早于当前 → 必须拒绝（`ERR-INPUT-003/004`、`ERR-STATE-002`），不得静默取 now（T1.4，TC-6）。
4. **写回历史值（A→B→A）**：必须是新版本 + 正常裁决，不是 `duplicate`、不复活旧行（T2.2，ET-A-06）。
5. **`asOf` 与阈值**：历史查询默认不被 `minWeight` 过滤，否则旅游场景的 0.25 旧偏好永远问不出来（T3.3，TC-4.8/ET-C-03）。

## 阶段门 vs 最终验收

[07 验收](./07-acceptance.md) 是**一次性终验**：AC-1…AC-12 全绿才算交付，不允许"部分通过"。

本计划是**增量闸口**：每个阶段（G1–G5）只要求"本阶段归属的用例 100% 绿 + 债务清零 + 证据入库"，**允许**其他 AC 尚未覆盖。两者关系：

| | 阶段门（本文） | 最终验收（07） |
|---|---|---|
| 频率 | 每 1 个阶段 | 交付时一次 |
| 判定 | 本阶段用例全绿 + 无 TODO 带入 | 全部 AC 全绿 |
| 失败 | 停在当前阶段，修完再前进 | 不交付 |
| 证据 | `evidence/G<n>/` | `evidence/AC-*/`（可复用阶段证据） |

**阶段门的三条硬规则**：

1. **归属用例 100% 绿**：表里列出的每一个编号都必须 pass，一个红即不通过。
2. **债务清零**：阶段结束时 `grep -r "TODO\|FIXME" src/` 必须为空；未完成项只能写成新任务，不能留注释。
3. **证据入库**：每阶段结束把命令输出/报告提交到 `evidence/G<n>/`，并打 tag `v0.1.0-m<n>`。

## 最终文件结构（锁定）

按 [ADR-0003](./08-decisions/adr-0003-project-structure.md)：

```
dsh-caml/
├─ package.json          # dsh.bundle + exports + 零 dependencies
├─ cordis.patch.yml      # 一行 entry
├─ tsconfig.json         # strict / ESM / outDir lib
├─ scripts/run-tests.mjs # 收集 test/**/*.test.ts 并调 node --import tsx --test
├─ src/
│  ├─ plugin.ts          # apply：配置→开库→注册工具→disposer
│  ├─ config.ts
│  ├─ domain/{types,normalize,validate,id,adjudicator}.ts
│  ├─ store/{port,sqlite,schema,migrate}.ts
│  └─ tools/{remember,recall,audit,render,register}.ts
├─ test/{harness,unit,integration,property,fault}/
├─ eval/{cases,run.ts,report}
├─ evidence/{G1..G5,AC-*}/
└─ docs/
```

## 阶段总览

| 阶段 | 目标 | 天数 | 门 | 覆盖 AC | 证据 |
|---|---|---|---|---|---|
| M1 | 骨架 + 无冲突闭环 | 2–3 | G1 | AC-1（部分） | `evidence/G1/` |
| M2 | 策略 A + 召回/审计分流 | 2–3 | G2 | AC-1、AC-2(A)、AC-3、AC-4(A) | `evidence/G2/` |
| M3 | 策略 B/C + 配置 + asOf | 2–3 | G3 | AC-2(B,C)、AC-3、AC-4、AC-5、AC-9 | `evidence/G3/` |
| M4 | 评测集 + 基线 + 属性测试 | 2–3 | G4 | AC-10、AC-11 | `evidence/G4/` |
| M5 | DSH 封装 + 性能/故障 + 交付 | 2–3 | G5 | AC-6、AC-7、AC-8、AC-12（+ 全量终验） | `evidence/G5/`、`evidence/AC-*` |

---

## M1 · 骨架与无冲突闭环

**目标**：插件能被假 ctx 加载、注册三个工具、建库；能写入一条事实并按坐标读回；无冲突路径不涉及裁决。

**任务**

### T1.1 仓库脚手架

**Files:** `package.json`、`cordis.patch.yml`、`tsconfig.json`、`scripts/run-tests.mjs`、`src/plugin.ts`

**Interfaces:**
- Produces: `apply(ctx: Context): void | (() => void)`；`package.json` 的 `dsh.bundle.patch = './cordis.patch.yml'`；npm scripts `test` / `eval` / `perf` / `build`。

- [ ] Step 1：写 `package.json`（`name: dsh-caml`、`engines.dsh`、`engines.node`、`dependencies: {}`、`devDependencies: { typescript, tsx, @types/node }`）与一行 `cordis.patch.yml`。
- [ ] Step 2：写 `scripts/run-tests.mjs`（`fs.readdir` 递归收集 `*.test.ts`，spawn `node --import tsx --test <files>`）。
- [ ] Step 3：写最小 `src/plugin.ts`（只 `export const name = 'dsh-caml'` + 空 `apply`）。
- [ ] Step 4：`npm test` → 期望 0 个测试、退出码 0；`node -e "require('./package.json')"` 检查清单。
- [ ] Step 5：提交 `chore: scaffold dsh-caml package`。

### T1.2 领域纯函数

**Files:** `src/domain/{types,normalize,validate,id}.ts`、`test/unit/domain.test.ts`

**Interfaces:**
- Produces: `normalizeSubject(s): string`、`normalizeObject(s): string`、`objectKey(o): string`（casefold 比较键）、`assertPredicate(p): void`、`newFactId(): string`、`newAdjudicationId(): string`、类型 `Fact`/`FactView`/`Strategy`/`AdjudicationPlan`。

- [ ] Step 1：写失败测试：全角/半角、大小写、空白折叠、emoji 长度按 code point、`predicate` 中文合法/含空格非法、id 前缀与唯一性。
- [ ] Step 2：`npm test` → 期望 FAIL（模块不存在）。
- [ ] Step 3：实现四个模块（NFKC → trim → 折叠；casefold 只用于比较；`Array.from().length` 计长）。
- [ ] Step 4：`npm test` → 期望 PASS。
- [ ] Step 5：提交 `feat(domain): normalization, validation and ids`。

### T1.3 SQLite schema 与 store 骨架

**Files:** `src/store/{port,schema,migrate,sqlite}.ts`、`test/integration/store-basic.test.ts`

**Interfaces:**
- Produces: `openStore(dbPath: string): Promise<FactStore>`；`FactStore` 方法 `current/remember/recall/audit/close`（签名见 [ADR-0003](./08-decisions/adr-0003-project-structure.md#关键接口形态)）；`SCHEMA_VERSION = 1`。

- [ ] Step 1：写失败测试：新库建表后 `PRAGMA user_version = 1`；重复 `openStore` 幂等；只读目录 → `ERR-STORE-001`；`user_version = 2` → `ERR-STORE-003`。
- [ ] Step 2：`npm test` → FAIL。
- [ ] Step 3：实现 `schema.ts`（[03 DDL](./03-data-model.md#ddl权威) 原样）+ `migrate.ts`（事务内建表）+ `sqlite.ts`（`DatabaseSync` + WAL + busy_timeout + 重试封装）。
- [ ] Step 4：`npm test` → PASS；用 `sqlite3`/脚本 dump 确认索引存在。
- [ ] Step 5：提交 `feat(store): schema, migrations and open/close`。

### T1.4 写入与读取（无冲突）

**Files:** `src/store/sqlite.ts`、`src/tools/{remember,recall,register,render}.ts`、`test/integration/remember-recall.test.ts`

**Interfaces:**
- Produces: 三个工具的 `parameters`/`output.schema`/`render`；`caml-remember` 返回 `{fact, action:'created', strategy:null, adjudication:null}`。

- [ ] Step 1：写失败测试：首次写入 → `created`；同值重写 → `duplicate` 且行数不变；未来时间 → `ERR-INPUT-004`；早于当前 `valid_from` → `ERR-STATE-002`（用 M1 的固定 time 夹具）。
- [ ] Step 2：`npm test` → FAIL。
- [ ] Step 3：实现 `remember`（校验 → 归一化 → current 查询 → duplicate/插入）、`recall`（默认过滤 + 排序 + limit/truncated）、`register.ts`。
- [ ] Step 4：`npm test` → PASS。
- [ ] Step 5：提交 `feat(tools): remember and recall happy path`。

### T1.5 插件装配与生命周期

**Files:** `src/plugin.ts`、`src/config.ts`、`test/harness/ctx.ts`、`test/integration/plugin-lifecycle.test.ts`

**Interfaces:**
- Consumes: T1.3 的 `openStore`、T1.4 的 `registerTools`。
- Produces: `apply(ctx)` 读配置 → 开库 → 注册三工具 → 返回 disposer（注销工具 + `store.close()`）。

- [ ] Step 1：写失败测试：合法配置下三工具注册；`dbPath` 不可写 → 抛 `ERR-STORE-001` 且不删库；disposer 调用后工具表为空；`dbPath` 相对路径按 `process.cwd()` 解析。
- [ ] Step 2：`npm test` → FAIL。
- [ ] Step 3：实现 `config.ts`（[02 配置契约](./02-api-contract.md#配置契约) 校验，`ERR-CONF-*`）与 `plugin.ts` 装配。
- [ ] Step 4：`npm test` → PASS。
- [ ] Step 5：提交 `feat(plugin): config, wiring and disposer`。

**G1 阶段门**

| # | 标准 | 判定 | 证据 |
|---|---|---|---|
| G1-1 | TC-1.1 / TC-6（B1–B12）/ IT-1（无冲突段）/ IT-2 / TC-4.1 全绿 | `npm test` | `evidence/G1/tests.log` |
| G1-2 | 新库 `user_version=1`，`ux_facts_one_active` 存在 | `node scripts/dump-schema.mjs` | `evidence/G1/schema.txt` |
| G1-3 | 假 ctx 下三工具注册，disposer 后注销 | IT-2 | 同上 |
| G1-4 | 无 TODO/FIXME，`dependencies` 为空 | `grep -r "TODO\|FIXME" src/`、`npm ls --prod` | `evidence/G1/deps.txt` |

**禁止的通过方式**：把 `recall` 写成返回内存数组（必须查库）；`audit` 返回硬编码空结构却被当作"已实现"（G1 允许空实现，但必须在 T2.1 替换并删除桩）。

**退出**：G1 全绿 → tag `v0.1.0-m1` → 进入 M2。

---

## M2 · 策略 A 与召回/审计分流

**目标**：冲突检测 + `supersede` 完整落地；`caml-recall` 默认不再返回旧值；`caml-audit` 还原时间线。

### T2.1 裁决计划与事务执行

**Files:** `src/domain/adjudicator.ts`、`src/store/sqlite.ts`、`test/unit/adjudicator.test.ts`、`test/integration/adjudication.test.ts`

**Interfaces:**
- Produces: `planAdjudication(input: {current: Fact[]; incoming: NewFact; strategy: Strategy; at: number}): AdjudicationPlan`；`AdjudicationPlan = { close: Fact[]; insert: Fact; relations: {from,to,type}[]; log: {...} }`。

- [ ] Step 1：写失败测试：A 策略下旧事实 `superseded`、`valid_until=at`、`superseded_by=新 id`；关系 `SUPERSEDES`；日志 1 条；`duplicate` 不写日志；A→B→A 生成新版本而非 duplicate（Review Focus 4）。
- [ ] Step 2：`npm test` → FAIL。
- [ ] Step 3：实现纯函数 `planAdjudication`（A 分支）+ `store.remember` 的事务执行（`BEGIN IMMEDIATE`，四件事同事务）。
- [ ] Step 4：`npm test` → PASS。
- [ ] Step 5：提交 `feat(adjudicator): supersede plan and transactional apply`。

### T2.2 召回默认过滤 + asOf 雏形

**Files:** `src/store/sqlite.ts`、`src/tools/recall.ts`、`test/unit/recall.test.ts`

**Interfaces:**
- Produces: `recall({subject?,predicate?,query?,asOf?,includeDecayed?,minWeight?,limit?})` 的过滤顺序严格按 [02](./02-api-contract.md#过滤语义按顺序)。

- [ ] Step 1：写失败测试：默认不返回 `superseded`；`limit`/`truncated`；`query` 转义 `%`/`_`；排序 `weight DESC, valid_from DESC, id ASC`。
- [ ] Step 2：`npm test` → FAIL。
- [ ] Step 3：实现 SQL 过滤与排序。
- [ ] Step 4：`npm test` → PASS。
- [ ] Step 5：提交 `feat(recall): default filtering and ordering`。

### T2.3 审计时间线

**Files:** `src/tools/audit.ts`、`test/integration/audit.test.ts`

**Interfaces:**
- Produces: `audit({subject,predicate,limit?})` 返回 `timeline` / `adjudications` / `summary` / `truncated`（[02](./02-api-contract.md#api-audit)）。

- [ ] Step 1：写失败测试：空坐标返回空结构不报错；3 版本按 `valid_from` 升序；每条裁决能在时间线找到 `adjudicationId`；`limit` 截断置位。
- [ ] Step 2：`npm test` → FAIL。
- [ ] Step 3：实现两个查询 + 合并。
- [ ] Step 4：`npm test` → PASS。
- [ ] Step 5：提交 `feat(audit): timeline and adjudication log`。

### T2.4 并发与忙重试

**Files:** `src/store/sqlite.ts`、`test/fault/busy.test.ts`

- [ ] Step 1：写失败测试：外部连接持锁 3s 时 `caml-remember` 重试 3 次后抛 `ERR-STORE-002`；期间 `caml-recall` 可读；两实例交替写不产生两条 active（Review Focus 1）。
- [ ] Step 2：`npm test` → FAIL。
- [ ] Step 3：实现 `withRetry`（50ms × 3）+ `BEGIN IMMEDIATE`。
- [ ] Step 4：`npm test` → PASS。
- [ ] Step 5：提交 `fix(store): busy retry and immediate write lock`。

**G2 阶段门**

| # | 标准 | 判定 | 证据 |
|---|---|---|---|
| G2-1 | TC-1、TC-2.1、TC-3.1/3.2/3.5/3.7、TC-4.1–4.3、IT-1/IT-3、ET-A-01…06 全绿 | `npm test`、`npm run eval -- --only A` | `evidence/G2/` |
| G2-2 | 默认召回不含旧值（反例） | ET-A-01 断言 | 报告 JSON |
| G2-3 | 一次裁决 = 1 条日志 + 每条旧事实 1 条关系 | IT-3 | 日志导出 |
| G2-4 | 契约测试：`caml-remember` 返回的 `action/relation` 落在枚举内 | TC-1 + schema 断言 | 同上 |

**禁止的通过方式**：先 `UPDATE` 再 `INSERT` 分两次提交（必须同事务）；用内存缓存伪造"旧值消失"。

**退出**：tag `v0.1.0-m2`。

---

## M3 · 策略 B/C、配置与 asOf

**目标**：三类策略齐全；配置驱动；历史查询（`asOf`）正确且不受阈值误伤。

### T3.1 策略 B 与关系类型

**Files:** `src/domain/adjudicator.ts`、`test/unit/adjudicator-b.test.ts`

- [ ] Step 1：写失败测试：B 与 A 的行级迁移相同，但关系为 `TRANSFERS_TO`、`action='transferred'`；审计把两个版本都还原。
- [ ] Step 2：`npm test` → FAIL；Step 3 实现；Step 4 PASS；Step 5 提交 `feat(adjudicator): versioned transfer`。

### T3.2 策略 C 与衰减

**Files:** `src/domain/adjudicator.ts`、`src/store/sqlite.ts`、`test/unit/adjudicator-c.test.ts`

- [ ] Step 1：写失败测试：C 不关窗口、`weight *= decayFactor`、`status='decayed'`；再次 C 继续乘；被衰减值得 `includeDecayed` 才召回。
- [ ] Step 2–5：FAIL → 实现 → PASS → 提交 `feat(adjudicator): weighted decay`。

### T3.3 asOf 与阈值语义

**Files:** `src/store/sqlite.ts`、`test/unit/asof.test.ts`

- [ ] Step 1：写失败测试：`asOf` 返回当时为真的事实（含已 superseded）；默认不被 `minWeight` 过滤（0.25 可召回）；显式 `minWeight` 才过滤；边界 `valid_until == asOf` 不返回（Review Focus 5）。
- [ ] Step 2–5：FAIL → 实现 → PASS → 提交 `feat(recall): asOf history without weight threshold`。

### T3.4 配置映射与校验

**Files:** `src/config.ts`、`test/unit/config.test.ts`

- [ ] Step 1：写失败测试：`byPredicate` 生效（同一 predicate 两种策略产生不同迁移）；非法值 → `ERR-CONF-001/002/003`；显式 `strategy` 覆盖配置。
- [ ] Step 2–5：FAIL → 实现 → PASS → 提交 `feat(config): predicate strategy mapping`。

### T3.5 安全边界

**Files:** `src/tools/render.ts`、`test/integration/security.test.ts`

- [ ] Step 1：写失败测试：事实正文含注入语句 → 原样存储、`render` 有边界标注；日志不含正文；全流程 `fetch`/`http.request` 未被调用。
- [ ] Step 2–5：FAIL → 实现 → PASS → 提交 `feat(tools): render boundaries and no-network test`。

**G3 阶段门**

| # | 标准 | 判定 | 证据 |
|---|---|---|---|
| G3-1 | TC-2.2–2.6、TC-3.3/3.4/3.6、TC-4.4–4.8、TC-5、IT-4、ET-B-01…05、ET-C-01…05 全绿 | `npm test`、`npm run eval -- --only B,C` | `evidence/G3/` |
| G3-2 | 同一 predicate 改配置后迁移改变 | 两次运行对比输出 | `evidence/G3/config-diff.txt` |
| G3-3 | 旅游场景"以前喜欢住哪"可回答 | ET-C-03/ET-C-05 | 报告 JSON |

**禁止的通过方式**：为 `asOf` 放宽全局阈值（必须仅在 `asOf` 分支生效）；把 C 的衰减写成"删除旧行"。

**退出**：tag `v0.1.0-m3`。

---

## M4 · 评测集、基线与属性测试

**目标**：16 条评测用例全绿；基线一次性对照可复现；不变量在随机序列下成立。

### T4.1 评测 runner 与用例

**Files:** `eval/run.ts`、`eval/cases/*.json`、`scripts/eval.mjs`

- [ ] Step 1：先写 ET-A-01 的 JSON + runner 断言，运行 → FAIL。
- [ ] Step 2：补全 16 条用例（A×6、B×5、C×5）。
- [ ] Step 3：实现 runner（临时库、逐用例断言、输出 `eval/report/report.json`）。
- [ ] Step 4：`npm run eval` → 16/16 PASS。
- [ ] Step 5：提交 `test(eval): 16-case conflict suite and runner`。

### T4.2 属性测试

**Files:** `test/property/invariants.test.ts`

- [ ] Step 1：写固定种子随机序列（500 次写）→ 断言 INV-1…INV-7、时间窗无空洞/重叠、重复输入幂等。
- [ ] Step 2–5：FAIL（若已通过则先证明能失败：临时放开索引）→ 实现所需查询 → PASS → 提交。

### T4.3 基线对照

**Files:** `eval/baseline.ts`、`eval/baseline.json`、`evidence/G4/baseline.log`

- [ ] Step 1：在隔离环境跑上游 1.6.0（0.1.7-rc.2 或自带 harness），按 [06 ET-B](./06-test-plan.md#基线对照-et-b) 口径记录两项指标。
- [ ] Step 2：写入 `eval/baseline.json`（含环境、命令、原始结果）。
- [ ] Step 3：README 草稿并列两个数字 + 口径差异说明。
- [ ] Step 4：提交 `test(eval): upstream baseline evidence`。

**G4 阶段门**

| # | 标准 | 判定 | 证据 |
|---|---|---|---|
| G4-1 | 16/16 通过，且连跑 3 次结果一致 | `npm run eval` ×3 | `evidence/G4/eval-*.json` |
| G4-2 | 属性测试 500 次无违例，种子可复现 | `npm test` | `evidence/G4/pt.log` |
| G4-3 | `eval/baseline.json` 存在，含环境与命令 | 文件审查 | 同文件 |
| G4-4 | README 数字与报告一致（脚本比对） | `node scripts/check-readme-numbers.mjs` | `evidence/G4/readme-check.txt` |

**禁止的通过方式**：用例断言写死结果（必须经过 store 与工具）；基线用"本插件"数据冒充上游。

**退出**：tag `v0.1.0-m4`。

---

## M5 · DSH 封装、性能、故障与交付

**目标**：在真实 DSH 0.2.1-rc.2 上可装可用；性能/故障达标；交付物齐全。

### T5.1 真实宿主加载

**Files:** `evidence/AC-6/`、`docs/`（安装说明）

- [ ] Step 1：在 DSH 0.2.1-rc.2 profile 加本地 patch 条目，启动 `dsh web`。
- [ ] Step 2：插件管理器确认 fiber active；新会话工具表出现三个工具；禁用后消失。
- [ ] Step 3：记录版本、命令、截图到 `evidence/AC-6/`。
- [ ] Step 4：修复移植问题（`systemPrompt.section`/事件形态），提交 `fix(plugin): dsh 0.2.1 compatibility`。

### T5.2 性能

**Files:** `scripts/perf.ts`、`evidence/AC-7/perf.json`

- [ ] Step 1：实现播种 10k + 1k 写/读/审计的测量脚本。
- [ ] Step 2：跑出 p50/p95，对照 [05 NFR-P](./05-non-functional.md#nfr-p-性能)。
- [ ] Step 3：不达标则只允许"加索引/改查询"，重新测量。
- [ ] Step 4：提交 `perf: benchmark script and results`。

### T5.3 故障注入

**Files:** `test/fault/*.test.ts`、`evidence/AC-8/`

- [ ] Step 1：FT-1（COMMIT 前抛错）、FT-2（损坏头部）、FT-4（DROP INDEX 后造双 active）、FT-5（卸载中事务）、FT-6（磁盘满 mock）。
- [ ] Step 2–4：逐条红→实现→绿；提交 `test(fault): crash, corrupt, busy and full-disk paths`。

### T5.4 交付物

**Files:** `README.md`（最终）、`LICENSE`、`NOTICE`、`docs/`、`evidence/`

- [ ] Step 1：README 补齐：定位、三场景演示、16/16 与基线、不做的事、安装、排障。
- [ ] Step 2：补 `LICENSE`（MIT）与 `NOTICE`（上游 AieXile v1.6.0、改动范围）。
- [ ] Step 3：录 5 分钟演示（三场景各一次"现在/之前"）。
- [ ] Step 4：`evidence/AC-12.md` 逐项打勾。
- [ ] Step 5：提交 `docs: final README, license and notice`。

**G5 阶段门（= 终验前置）**

| # | 标准 | 判定 | 证据 |
|---|---|---|---|
| G5-1 | AC-6/7/8 全绿 | 07 对应命令 | `evidence/AC-6..8/` |
| G5-2 | AC-12 清单全勾 | 人工核对 | `evidence/AC-12.md` |
| G5-3 | 干净 checkout 上 `npm test && npm run eval && npm run perf` 全绿 | 三条命令 | `evidence/G5/clean.log` |
| G5-4 | 追踪矩阵无空行；README 数字与报告一致 | 脚本 + 人工 | 同上 |

**退出**：跑完 [07](./07-acceptance.md) 全量 AC-1…AC-12 → tag `v1.0.0` → 仓库转公有。

---

## 跨阶段规则

1. **TDD**：每个任务先写失败测试并确认失败（Step 2 必须有 FAIL 输出），再实现。
2. **提交粒度**：一个任务一次提交；信息用 `feat|fix|test|docs(scope): ...`。
3. **债务清零**：阶段门不过时不允许开下一阶段；"临时桩"必须在下一任务内删除。
4. **证据即交付**：阶段证据提交到 `evidence/G<n>/`，终验直接复用，不重跑造数。
5. **契约变更**：任何字段/工具名/默认值变更，先改 [02](./02-api-contract.md) 与 [08](./08-decisions/README.md)，再改代码。

## 风险与回滚

| 风险 | 触发点 | 回滚/缓解 |
|---|---|---|
| DSH 0.2.1 接线不兼容 | T5.1 | 修 3 天内；否则按 [ADR-0001 备选](./08-decisions/adr-0001-base-plugin.md#备选方案) 换底座（接口不变，仅换 `plugin.ts`） |
| SQLite 在目标 OS 的 `STRICT` 不支持 | T1.3 | 去掉 `STRICT`，保留全部 `CHECK`，在 README 记录 |
| 评测数字与 README 不一致 | G4-4 | 以报告为准改 README，不允许反向改 |
| 两周超期 | 任意 | 砍 M5 的演示视频与 `resolve_conflict`，保 AC-1…AC-11；M5 只留 T5.1/T5.4 必做项 |

## 阶段 → AC 映射（终验口径）

| AC | 归属阶段 | 说明 |
|---|---|---|
| AC-1 | M2 | M1 先满足无冲突部分 |
| AC-2 | M2(A) / M3(B,C) | 全部在 M3 结束前闭合 |
| AC-3 | M2 | 默认召回反例 |
| AC-4 | M2(A) / M3 | 审计在 B/C 后完整 |
| AC-5 | M3 | 配置驱动 |
| AC-6 | M5 | 真实宿主 |
| AC-7 | M5 | 性能 |
| AC-8 | M5 | 故障 |
| AC-9 | M3 | 安全边界 |
| AC-10 | M4 | 属性测试 |
| AC-11 | M4 | 评测 + 基线 |
| AC-12 | M5 | 交付物 |

## 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-08 | v1.0 | 初版：5 阶段、5 道门、按 TDD 拆 20 个任务 |
