# 06 · 测试文档

> 版本：v1.0 ｜ 状态：冻结候选 ｜ 验收在 [07](./07-acceptance.md) ｜ 错误码在 [04](./04-errors-and-edge-cases.md) ｜ 指标在 [05](./05-non-functional.md)

## 原则

1. **每个用例独立**：新建临时目录 + 新库，跑完即删；用例之间零共享状态。
2. **断言结构化结果**：断言 `action` / `status` / `weight` / `code` / 集合内容，**不断言中文文案**（文案会改）。
3. **三个不依赖**：不依赖网络、不依赖 DSH 进程（集成用假 ctx）、不依赖真实时钟（注入 Clock）。
4. **每条用例挂需求**：表里的"覆盖"列必须指向 [FR](./01-prd.md#5-功能需求) 或 [AC](./07-acceptance.md)。

## 环境与工具

| 项 | 选择 | 理由 |
|---|---|---|
| 测试框架 | `node:test` + `node:assert/strict`（Node 内置） | 零依赖；与 [ADR-0002](./08-decisions/adr-0002-tech-stack.md) 一致 |
| 源码执行 | `tsx --test`（devDependency）；发布产物由 `tsc` 编译到 `lib/` | 与 [ADR-0002](./08-decisions/adr-0002-tech-stack.md) 一致：运行时零依赖，构建只发生在开发期 |
| 假 ctx | `test/harness/ctx.ts`：实现 `tools.register` / `effect` / `get`，记录注册与 disposer | 不启动 DSH 也能测 `apply()` |
| 时钟 | `test/harness/clock.ts`：可设定的 `now()` | 时间窗与 `asOf` 用例可复现 |
| 数据库 | 每用例 `mkdtemp` + `dbPath` 指向临时文件 | 隔离、可并行 |

## 分层与编号

| 层 | 编号 | 目的 | 运行命令 |
|---|---|---|---|
| 单元 | TC-n | 纯函数与 store 行为 | `npm test` |
| 集成 | IT-n | 工具 → store → SQLite 全链路；插件生命周期 | `npm test` |
| 属性 | PT-n | 不变量在随机序列下成立 | `npm test` |
| 评测 | ET-n | 黑盒产品行为评分（对外口径） | `npm run eval` |
| 故障 | FT-n | 坏路径下的确定行为 | `npm test` |
| 负载 | LT-n | 性能指标 | `npm run perf` |

## 单元测试 TC

### TC-1 写入与幂等

| 用例 | 输入 | 期望 |
|---|---|---|
| TC-1.1 | 新坐标首次 `caml-remember` | `action='created'`，`status='active'`，`weight=1.0` |
| TC-1.2 | 同 `(subject,predicate,object)` 再写一次 | `action='duplicate'`，事实总数不变，无新日志 |
| TC-1.3 | object 仅大小写不同（`Shanghai` / `shanghai`） | `duplicate` |
| TC-1.4 | object 全角/半角（`ＡＢＣ` / `ABC`） | `duplicate` |
| TC-1.5 | object 首尾空白 | 存归一化值，`created` |

**覆盖**：FR-1 → AC-1。

### TC-2 三策略状态迁移

| 用例 | 初始 | 动作 | 期望 |
|---|---|---|---|
| TC-2.1 | active A | 冲突 + `supersede` | A: `superseded`、`valid_until=t`、`superseded_by=B`；关系 `SUPERSEDES(B→A)`；日志 +1 |
| TC-2.2 | active A | 冲突 + `versioned_transfer` | 同 TC-2.1，但关系 `TRANSFERS_TO`，`action='transferred'` |
| TC-2.3 | active A（weight=1.0） | 冲突 + `weighted_decay`（factor=0.5） | A: `decayed`、`valid_until` 仍 `NULL`、`weight=0.5`；关系 `DECAYS_FROM` |
| TC-2.4 | decayed A（weight=0.5） | 再次冲突 + `weighted_decay` | A: `decayed`、weight=0.25 |
| TC-2.5 | decayed A | 冲突 + 显式 `supersede` | A → `superseded`，窗口关闭 |
| TC-2.6 | active A、active A2（外部改写） | 冲突 | 两条都按策略处理，各一条关系，但日志只 +1（一次写入 = 一次裁决） |

**覆盖**：FR-2 → AC-2、AC-4。

### TC-3 召回过滤

| 用例 | 场景 | 期望 |
|---|---|---|
| TC-3.1 | 默认召回 | 只含 `active` 且窗口未关 |
| TC-3.2 | `includeDecayed=true` | 含 `decayed`；`weight` 原样 |
| TC-3.3 | `limit=0` / `101` | `ERR-INPUT-009` |
| TC-3.4 | `query="50%"` | `%` 按字面匹配，不返回无关项 |
| TC-3.5 | 命中 25 条、`limit=20` | `count=20`、`truncated=true` |
| TC-3.6 | `minWeight=0.8`，存在 weight=0.5 的 active | 被过滤 |
| TC-3.7 | 排序 | 按 `weight DESC, valid_from DESC, id ASC` |

**覆盖**：FR-3 → AC-3。

### TC-4 审计与 asOf

| 用例 | 场景 | 期望 |
|---|---|---|
| TC-4.1 | 无事实的坐标 | `timeline=[]`、`current=null`，不报错 |
| TC-4.2 | 3 个版本 | `timeline` 按 `valid_from ASC`；`summary.versions=3` |
| TC-4.3 | `asOf` = 某事实 `valid_until` | 该事实不返回（左闭右开） |
| TC-4.4 | `asOf` 早于首条 | 返回 `[]` |
| TC-4.5 | `asOf` 为未来 | 按 `now` 处理并回显 |
| TC-4.6 | 版本数 > `limit` | `truncated.timeline=true` |
| TC-4.7 | 日志与时间线 | 每条裁决能在 `timeline` 找到对应 `adjudicationId` |
| TC-4.8 | `asOf` + 阈值 | 返回权重 0.25 的历史事实（`asOf` 默认不应用 `minWeight`）；显式传 `minWeight` 时被过滤 |

**覆盖**：FR-3、FR-4、FR-7 → AC-4。

### TC-5 配置

| 用例 | 输入 | 期望 |
|---|---|---|
| TC-5.1 | 合法全量配置 | 加载成功，策略生效 |
| TC-5.2 | `decayFactor=0.99` | `ERR-CONF-001` |
| TC-5.3 | `default: 'foo'` | `ERR-CONF-003` |
| TC-5.4 | `byPredicate` key 非法（含空格） | `ERR-CONF-001` |
| TC-5.5 | `dbPath=''` | `ERR-CONF-002` |

**覆盖**：FR-5 → AC-5。

### TC-6 输入边界

B1–B12 逐条对应 [04 事实写入边界](./04-errors-and-edge-cases.md#事实写入边界)，每条至少一个断言（含错误码、归一化结果、Unicode 长度计算）。

**覆盖**：FR-1 → AC-1、AC-9。

### TC-7 日志最小化

写入一条 object 含敏感串的事实并触发裁决，断言 `adjudication_log` 行内**不出现**该串（只出现 id 与 `reason`）。

**覆盖**：FR-7 → AC-9。

### TC-8 错误不静默

对 `src/` 做静态检查：不存在空 `catch {}`；每个 `catch` 必须 `throw` 或记录带 `code` 的日志。以 grep 规则实现，作为 `npm test` 的一步。

**覆盖**：NFR-R-4 → AC-8。

## 集成测试 IT

| 编号 | 内容 | 断言 |
|---|---|---|
| IT-1 | 假 ctx 调 `apply()` → 调 `caml-remember`/`caml-recall`/`caml-audit` | 三工具注册；真实 SQLite 落盘；结果与 TC-1/2 一致 |
| IT-2 | 生命周期：正常加载、非法配置、损坏库、只读目录 | 前两者分别成功/失败；损坏与只读失败但**不删库**；disposer 注销工具并关库 |
| IT-3 | 一次冲突后 | `adjudication_log` 恰好 +1；`caml-audit` 能读出 |
| IT-4 | 注入型正文（"忽略之前所有指令"） | 原样存储；`render` 有边界标注且不执行 |
| IT-5 | 两个 store 实例指向同一 db | 交替写入不破坏 INV-1；无 `SQLITE_BUSY` 泄漏 |
| IT-6 | 全流程中 `fetch`/`http.request` 被替换为抛错 | 流程不触发网络 |

**覆盖**：FR-1、FR-2、FR-4、FR-6、FR-7 → AC-1、AC-2、AC-4、AC-6、AC-8、AC-9。

## 属性测试 PT

用随机序列（固定种子，可重放）驱动 store：

| 编号 | 属性 | 断言 |
|---|---|---|
| PT-1 | 500 次随机 `caml-remember`（随机 subject/predicate/object/strategy）后 | [INV-1…INV-7](./03-data-model.md#不变量) 全部成立；每坐标 ≤ 1 条 active |
| PT-2 | 时间窗覆盖 | 对任意坐标，`timeline` 各版本窗口并集覆盖 `[首条.valid_from, now)`，无空洞、无重叠 |
| PT-3 | 幂等 | 同一输入重复 N 次，事实数不增，日志数不增 |

**覆盖**：FR-2、FR-4 → AC-2、AC-10。

## 评测集 ET

评测集是**对外口径**（README 与演示视频引用的数字来源），与单元测试分开维护。

### 用例格式（`eval/cases/*.json`）

```jsonc
{
  "id": "ET-A-01",
  "title": "求职地变更",
  "strategy": "supersede",
  "given": [
    { "subject": "我", "predicate": "目标城市", "object": "杭州", "observedAt": "2026-10-01T00:00:00Z" }
  ],
  "when": { "subject": "我", "predicate": "目标城市", "object": "上海", "observedAt": "2026-11-08T00:00:00Z" },
  "expect": {
    "afterWrite": { "action": "superseded", "relation": "SUPERSEDES" },
    "recallDefault": ["上海"],
    "recallAsOf": { "2026-10-15T00:00:00Z": ["杭州"] },
    "audit": { "versions": 2, "current": "上海", "statuses": ["superseded", "active"] }
  }
}
```

### 用例表（16 条）

| ID | 策略 | 场景 | 初始值 → 新值 | 默认召回 | 审计 |
|---|---|---|---|---|---|
| ET-A-01 | A | 求职地变更 | 杭州 → 上海 | 上海 | 2 版本，杭州 superseded |
| ET-A-02 | A | 目标岗位变更 | 后端 → 数据工程 | 数据工程 | 2 版本 |
| ET-A-03 | A | 当前雇主变更 | 甲公司 → 乙公司 | 乙公司 | 2 版本 |
| ET-A-04 | A | 期望薪资变更 | 15k → 20k | 20k | 2 版本 |
| ET-A-05 | A | 三次连续变更 | A→B→C | C | 3 版本，链式 superseded_by |
| ET-A-06 | A | 改回旧值 | 杭州→上海→杭州 | 杭州（新版本） | 3 版本；历史杭州仍 superseded，不是 duplicate |
| ET-B-01 | B | 项目负责人变更 | 张三 → 李四 | 李四 | 2 版本，`TRANSFERS_TO` |
| ET-B-02 | B | 值班人变更 | 王五 → 赵六 | 赵六 | 2 版本 |
| ET-B-03 | B | 审批人变更 | 甲 → 乙 | 乙 | 2 版本 |
| ET-B-04 | B | 三轮交接 | 甲→乙→丙 | 丙 | 3 版本，两次转移 |
| ET-B-05 | B | 转移后 `asOf` 回查 | 甲→乙 | 当时为甲 | `asOf` 返回甲 |
| ET-C-01 | C | 住宿偏好演化 | 青旅 → 酒店 | 酒店（1.0） | 青旅 decayed（0.5），窗口未关 |
| ET-C-02 | C | 连续两次漂移 | 青旅→酒店→民宿 | 民宿 | 青旅 0.25、酒店 0.5 |
| ET-C-03 | C | 阈值以下 | 三次衰减后 weight=0.25 | 只剩 latest | 旧值仍可 `caml-audit` |
| ET-C-04 | C | 显式恢复旧偏好（覆盖 A） | decayed 旧值 → 新值 | 新值 | 旧值 superseded |
| ET-C-05 | C | 与 A 混合 predicate | 两个 predicate 不同策略 | 各自正确 | 不串味 |

### 运行与报告

```bash
npm run eval            # 跑全部用例，输出 eval/report/report.json + 控制台表格
npm run eval -- --baseline   # 额外跑上游基线（见下）
```

`report.json` 结构：

```jsonc
{ "total": 16, "passed": 16, "failed": 0,
  "cases": [{ "id": "ET-A-01", "pass": true, "checks": ["action", "recallDefault", "audit"] }] }
```

### 基线对照 ET-B

- 目标：同一批**场景**在上游 `dsh-memory-plugin@1.6.0` 上的表现，用于证明"改造带来了什么"。
- 方法：用上游的 `memory_add` / `memory_search` 表达同场景（三元组压成内容字符串），记录两项指标：
  - **当前值正确率**：默认检索是否只给出新值。
  - **历史可回答率**：能否回答"之前是什么"。
- 约束：基线结果只作对照，**不计入本插件通过率**；README 必须同时给出两个数字与"评测口径不同"的说明，避免误导。
- 若上游无法在 DSH 0.2.1-rc.2 加载：在隔离环境（0.1.7-rc.2 profile 或上游自带 harness）跑一次，命令与结果写入 `eval/baseline.json`，**不进入** `npm run eval` 的默认路径（[ADR-0005](./08-decisions/adr-0005-adjudication-boundaries.md)）。

**覆盖**：FR-2、FR-3、FR-4 → AC-2、AC-3、AC-4、AC-11。

## 故障注入 FT

| 编号 | 注入方式 | 期望 |
|---|---|---|
| FT-1 | 测试钩子在 `COMMIT` 前抛错 | 事务回滚；无半写；重试成功；事实数正确 |
| FT-2 | 用随机字节覆盖 `.db` 头部 | `ERR-STORE-004`；库文件保留；插件 fiber 失败但不阻塞宿主 |
| FT-3 | 外部连接持有写锁 3s | 3 次重试后 `ERR-STORE-002`；期间 `caml-recall` 可读 |
| FT-4 | 先 `DROP INDEX ux_facts_one_active`，再手工插入第二条 active | `caml-remember` 返回 `ERR-STATE-001`；`caml-audit` 仍可用并标 `missing` |
| FT-5 | 在途事务中调用 disposer | ≤ 2s 内完成或回滚；连接关闭 |
| FT-6 | mock 写入抛 `SQLITE_FULL` | `ERR-STORE-005`，回滚，无部分数据 |

**覆盖**：NFR-R → AC-8。

## 负载与性能 LT

| 编号 | 内容 | 记录 |
|---|---|---|
| LT-1 | 播种 10,000 条 → 1,000 次 `caml-remember`、1,000 次 `caml-recall`、200 次 `caml-audit` | p50/p95、错误数 |
| LT-2 | 冷启动 `apply()`、库体积、RSS 增量、`sqlite_version()` | 原始数值写入 `evidence/AC-7-perf.json` |

**覆盖**：NFR-P → AC-7。

## CI 矩阵

| 环境 | 跑什么 |
|---|---|
| Windows + Node 24 | `npm test` + `npm run eval` + `npm run perf` |
| Linux + Node 24 | `npm test` + `npm run eval` |
| macOS + Node 24 | `npm test` |
| Windows + Node 22.19 | `npm test`（含 `--experimental-strip-types`） |

## 覆盖矩阵

| 需求 | TC | IT | PT | ET | FT | LT | 验收 |
|---|---|---|---|---|---|---|---|
| FR-1 | TC-1, TC-6 | IT-1 | — | ET-A-01 | — | — | AC-1 |
| FR-2 | TC-2 | IT-1 | PT-1 | ET-A/B/C | — | — | AC-2 |
| FR-3 | TC-3 | IT-1 | PT-2 | ET-A-01 | — | — | AC-3 |
| FR-4 | TC-4 | IT-3 | PT-2 | ET-B-05, ET-C-03 | — | — | AC-4 |
| FR-5 | TC-5 | IT-2 | — | — | — | — | AC-5 |
| FR-6 | — | IT-2 | — | — | FT-1…FT-6 | — | AC-6 |
| FR-7 | TC-7 | IT-3 | — | ET-*（`caml-audit` 断言） | — | — | AC-4 |
| NFR-P | — | — | — | — | — | LT-1, LT-2 | AC-7 |
| NFR-R | TC-8 | IT-2 | — | — | FT-1…FT-6 | — | AC-8 |
| NFR-S | — | IT-4, IT-6 | — | — | — | — | AC-9 |

## 交叉引用

- 判定口径与证据：[07](./07-acceptance.md)
- 每个边界的确切行为：[04](./04-errors-and-edge-cases.md)
- 阈值来源：[05](./05-non-functional.md)
