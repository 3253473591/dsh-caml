# 07 · 验收标准

> 版本：v1.0 ｜ 状态：冻结候选 ｜ 用例来自 [06](./06-test-plan.md) ｜ 指标来自 [05](./05-non-functional.md) ｜ 需求来自 [01](./01-prd.md)

验收是"能不能交付"的唯一判据。**每条 AC 必须有可执行方法、可保存的证据、明确的失败条件**；"看起来没问题"不算通过。阶段门（增量闸口）与本文（一次性终验）的区别见 [09 执行计划](./09-execution-plan.md#阶段门-vs-最终验收)。

> **2026-11-09 范围调整**：AC-12 的"演示视频"一项取消（用户决定，不单独作为项目）。其余 AC 不变；AC-7 的 `caml-recall` p95 保留为**已知差距**（23.8ms vs 15ms，准确性优先），不视为阻断。

## 前置条件

| 项 | 要求 |
|---|---|
| 运行时 | DSH `0.2.1-rc.2`，Node `24.22.1`（或 22.19 兼容检查） |
| 工作区 | 干净 checkout；`npm install` 后无 `node_modules` 变更以外的改动 |
| 数据 | 所有 AC 使用临时库；唯一的持久库只在 AC-6 的人工演示中使用 |
| 证据目录 | `evidence/`，每条 AC 一个文件或子目录（日志、JSON、截图） |

## 验收项

### AC-1 写入、幂等、归一化

- **方法**：`npm test -- TC-1 TC-6`
- **期望**：TC-1.1–1.5、TC-6 全绿；重复写入不增加行数；全角/半角/大小写按归一化规则判等。
- **证据**：`evidence/AC-1.log`
- **失败条件**：任一用例红，或重复写入导致行数增加。
- **关联**：[FR-1](./01-prd.md#fr-1-写入与冲突检测)

### AC-2 三类裁决的状态迁移

- **方法**：`npm test -- TC-2 TC-5`；`npm run eval -- --only A,B,C`
- **期望**：TC-2.1–2.6 全绿；ET-A/B/C 共 16 条全绿；每条旧事实 1 条关系，每次写入只 1 条日志。
- **证据**：`evidence/AC-2.log` + `eval/report/report.json`
- **失败条件**：任一策略的 `status`/`weight`/`valid_until` 与 [02 状态迁移表](./02-api-contract.md#状态迁移唯一权威表) 不一致。
- **关联**：[FR-2](./01-prd.md#fr-2-三类裁决策略)

### AC-3 默认召回的反例

- **方法**：`npm test -- TC-3`；手动步骤：写入旧值 → 写入新值 → `caml-recall`，断言结果里**没有**旧值。
- **期望**：被取代/被衰减的事实不出现在默认召回；`includeDecayed=true` 时才出现。
- **证据**：`evidence/AC-3.log`
- **失败条件**：旧值出现在默认召回（这是整个产品要解决的核心问题）。
- **关联**：[FR-3](./01-prd.md#fr-3-默认召回)

### AC-4 审计可还原

- **方法**：`npm test -- TC-4 IT-3`；`npm run eval -- --only A,B,C`
- **期望**：每个场景的 `timeline` 版本数、状态序列、`current` 与期望一致；三类问题都能回答：
  1. 现在是什么？（`caml-recall`）
  2. 之前是什么？（`caml-audit` / `asOf`）
  3. 为什么变？（`adjudications` 的 `strategy` + `reason`）
- **证据**：`evidence/AC-4.log` + 每个场景的 `caml-audit` JSON 快照
- **失败条件**：时间线断链、日志与时间线对不上、`asOf` 边界错误。
- **关联**：[FR-4](./01-prd.md#fr-4-审计召回)、[FR-7](./01-prd.md#fr-7-裁决日志)

### AC-5 配置驱动行为

- **方法**：`npm test -- TC-5`；手动改 `byPredicate` 后重跑 ET-A-01，确认行为随配置改变。
- **期望**：同一 predicate 在两种映射下产生不同迁移；非法配置加载即失败。
- **证据**：`evidence/AC-5.log`（含两次配置的对比输出）
- **失败条件**：配置被静默忽略或静默回退默认值。
- **关联**：[FR-5](./01-prd.md#fr-5-策略配置)

### AC-6 DSH 0.2.1-rc.2 加载与工具注册

- **方法**：
  1. 在 DSH profile 的 patch 中加入插件（`dsh plugin --profile web add <path>` 或本地 `name:` 条目）；
  2. 启动 `dsh web`；
  3. 在插件管理器中确认插件 fiber 为 active；
  4. 新会话的工具表中确认 `caml-remember` / `caml-recall` / `caml-audit` 可见；
  5. 禁用插件，确认三工具消失。
- **期望**：`engines.dsh` 通过兼容门；加载 ≤ 100ms；禁用后工具注销；库文件保留。
- **证据**：`evidence/AC-6-load.log` + 截图（工具表、插件状态）
- **失败条件**：加载失败、工具缺失、禁用后仍可调用、宿主启动被阻塞。
- **关联**：[FR-6](./01-prd.md#fr-6-工具注册与生命周期)、[NFR-C-1](./05-non-functional.md#nfr-c-兼容性)

### AC-7 性能达标

- **方法**：`npm run perf`（LT-1、LT-2）
- **期望**：NFR-P-1…P-7 全部在阈值内，原始数值写入报告。
- **证据**：`evidence/AC-7-perf.json`
- **失败条件**：任一 p95 超阈值，或环境未记录（无法复现的数值不算证据）。
- **关联**：[NFR-P](./05-non-functional.md#nfr-p-性能)

### AC-8 故障路径行为正确

- **方法**：`npm test -- FT`（FT-1…FT-6）+ TC-8 静态检查
- **期望**：崩溃无半写、损坏不删库、忙可自愈或明确报错、磁盘满回滚、卸载安全、无空 catch。
- **证据**：`evidence/AC-8.log`
- **失败条件**：出现部分写入、数据被删、错误被吞。
- **关联**：[NFR-R](./05-non-functional.md#nfr-r-容错与可靠性)、[04 存储边界](./04-errors-and-edge-cases.md#存储与生命周期边界)

### AC-9 安全边界

- **方法**：`npm test -- IT-4 IT-6 TC-7`
- **期望**：全流程无网络调用；日志不含 object 正文；注入型文本只作为数据渲染；README 明确"不扫描密钥"。
- **证据**：`evidence/AC-9.log` + README 对应段落
- **失败条件**：出现出站请求、日志泄漏正文、把记忆内容拼成指令。
- **关联**：[NFR-S](./05-non-functional.md#nfr-s-安全与隐私)

### AC-10 不变量在随机序列下成立

- **方法**：`npm test -- PT-1 PT-2 PT-3`（固定种子，可重放）
- **期望**：500 次随机操作后 INV-1…INV-7 全部成立；时间窗无空洞无重叠；重复输入幂等。
- **证据**：`evidence/AC-10.log`（含种子值）
- **失败条件**：任一不变量被破坏；或失败后无法用记录的种子复现。
- **关联**：[INV-1…7](./03-data-model.md#不变量)

### AC-11 评测集 100% + 基线对照

- **方法**：`npm run eval -- --baseline`
- **期望**：16/16 通过；基线对照两个指标（当前值正确率、历史可回答率）有数字并与本插件并列写进 README。
- **证据**：`eval/report/report.json`（含 `baseline` 段）
- **失败条件**：任一用例失败；或只报本插件数字、不报基线（会被视为选择性披露）。
- **关联**：[ET](./06-test-plan.md#评测集-et)、[01 §7](./01-prd.md#7-验证场景与演示脚本)

### AC-12 交付物与合规

- **方法**：人工核对清单
- **期望**：

| 交付物 | 判定 |
|---|---|
| 源码仓库（可独立安装） | `package.json` 的 `dependencies` 为空；`engines.dsh` 存在 |
| README | 含：定位、三场景演示、评测通过率、基线对照、不做的事、安装步骤 |
| 文档集 | `docs/README.md` 追踪矩阵无空行 |
| 评测报告 | `eval/report/report.json` 与 README 数字一致 |
| 演示视频 | ≤ 5 分钟，覆盖三个场景各一次"现在/之前"问答 |
| 许可证 | 保留上游 MIT LICENSE；`NOTICE` 注明基线插件与改动范围；包名与上游不同 |
| 致谢 | README 有独立「致谢」段：基线插件、DSH、调研参考项目各列一条并给链接 |
| 无 UI 半边 | 包内无 `./client` 导出、无 `dsh.client` 声明（与 [NG-4](./01-prd.md#32-明确不做) 一致） |
| 排障脚本 | `ERR-STATE-001` 修复脚本与说明，修复后重建 `ux_facts_one_active` |

- **证据**：`evidence/AC-12.md`（逐项打勾 + 链接）
- **失败条件**：缺项；或 README 数字与报告不一致（视为诚信问题，直接不通过）。
- **关联**：[ADR-0004 红线](./08-decisions/adr-0004-red-lines.md)

## 通过判定

```
通过 = AC-1 … AC-12 全部 pass
```

- 任一条 fail → **不通过**，不允许"部分通过"。
- 文档错别字、措辞不优雅：非阻断项，记录在 `evidence/AC-12.md` 的"已知瑕疵"。
- 数字类 AC（AC-7、AC-11）：允许在**记录环境**下重跑一次；重跑仍不达标即 fail。

## 失败归类模板

每次失败在报告中写一行，便于面试时讲"我知道哪里会坏"：

| 字段 | 示例 |
|---|---|
| 用例 | ET-C-02 |
| 现象 | 默认召回同时返回"酒店"与"民宿" |
| 根因 | 第二次 decay 未把第一条 active 降级 |
| 归类 | 裁决状态机缺陷 |
| 修复 | 裁决前统一查询 `status IN ('active','decayed')` |
| 回归 | TC-2.4 增加断言 |

## 复核清单（提交前逐项打勾）

- [ ] 追踪矩阵每行都有对应用例与 AC
- [ ] 所有错误码在测试里至少被断言一次
- [ ] 每个 NG 在 README 有对应"不做"说明
- [ ] `npm test` / `npm run eval` / `npm run perf` 在干净 checkout 可复现
- [ ] 证据目录完整，数字与 README 一致
- [ ] 上游 LICENSE 与 NOTICE 保留
- [ ] 没有把 MySQL/PostgreSQL/ORM 引入 `dependencies`

## 交叉引用

- 用例定义：[06](./06-test-plan.md)
- 阈值：[05](./05-non-functional.md)
- 决策与红线：[08](./08-decisions/README.md)
