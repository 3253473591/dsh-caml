# 01 · 产品需求文档（PRD）

> 版本：v1.0 ｜ 日期：2026-11-08 ｜ 状态：设计冻结候选 ｜ 取代：[PRD V0.1](./PRD%20V0.1.md) ｜ 运行时：DSH `0.2.1-rc.2`

## 1 背景与问题

DSH 采用 Cordis 微内核，记忆以插件形式挂载。社区已有 `dsh-memory`（RestRegular，12★）、`dsh-mnemon`（930★）、`meow-memory`（377★）、`dsh-peoplememory`（骨架）等插件，均为 MIT。调研结论（详见 [ADR-0001](./08-decisions/adr-0001-base-plugin.md)）：

- 这些插件解决的是"**记得住**"：抽取、检索、注入、去重、分层。
- 没有一个解决"**记错了怎么办**"：事实被新信息推翻后，旧值要么被静默覆盖（丢失审计），要么与新值共存（召回随机命中）；手工 `supersedes`/归档只是事后补丁，不是裁决语义。
- 后果：时间敏感事实（当前雇主、当前城市、当前负责人、当前偏好）在召回时可能给出过时答案，且**没有任何可自动判定的通过标准**。

## 2 产品定位

**一句话**：一个面向 DSH 的记忆层插件——对可变状态事实的冲突给出**显式裁决语义**，并附带**可自动跑分的冲突评测集**。

- 直接用户：加载本插件的 DSH Agent 开发者。
- 演示用户：求职场景中的应届生本人（三个验证场景之一）。
- 差异化不是"更多记忆功能"，而是"**裁决契约 + 可验收**"。

## 3 范围

### 3.1 v1 交付

| 需求 | 一句话 | 详见 |
|---|---|---|
| [FR-1](#fr-1-写入与冲突检测) | `caml-remember` 写入时检测同 `(subject, predicate)` 的当前有效事实 | [02 API](./02-api-contract.md#api-remember) |
| [FR-2](#fr-2-三类裁决策略) | A 取代 / B 版本化转移 / C 加权衰减 | [03 数据](./03-data-model.md#状态机) |
| [FR-3](#fr-3-默认召回) | 默认只回当前有效且未衰减的事实 | [02 API](./02-api-contract.md#api-recall) |
| [FR-4](#fr-4-审计召回) | 还原完整时间线与裁决记录 | [02 API](./02-api-contract.md#api-audit) |
| [FR-5](#fr-5-策略配置) | predicate → 策略映射、衰减系数、权重阈值 | [05 兼容](./05-non-functional.md#nfr-c-兼容性) |
| [FR-6](#fr-6-工具注册与生命周期) | 通过 `ctx.tools` 注册、卸载即注销、加载失败不拖垮宿主 | [02 API](./02-api-contract.md#api-register) |
| [FR-7](#fr-7-裁决日志) | 每次裁决一条可读记录 | [03 数据](./03-data-model.md#ds-log) |

### 3.2 明确不做

| 编号 | 不做 | 理由 |
|---|---|---|
| NG-1 | 向量检索 / 语义相似度 | v1 只用结构化过滤 + 关键词；避免运行时下载模型与向量库 |
| NG-2 | 由 LLM 参与裁决 | 裁决必须确定性、可复现、可自动判分；LLM 只允许出现在"未来工作" |
| NG-3 | 待确认冲突队列（`pending` + 人工审批） | 状态机翻倍，且会削弱"契约可自动验证"的叙事；留给 v1.1 |
| NG-4 | 自动注入 / 客户端面板 UI | v1 只做工具面；注入是另一条链路（压缩、去重、预算），会把范围拉大 |
| NG-5 | 多租户 / scope / 权限隔离 | v1 单工作区单库；scope 是产品能力不是契约能力 |
| NG-6 | 外部数据库（MySQL/PostgreSQL）与 ORM | 见 [ADR-0002](./08-decisions/adr-0002-tech-stack.md) |
| NG-7 | 自动迁移上游插件的历史数据 | 数据模型不同（自由文本 → 结构化事实），跨模型迁移会引入猜测；v1 提供文档说明，不提供脚本 |
| NG-8 | 多模态、图数据库、跨设备同步 | 与"边界清晰、可严格验收"的定位冲突 |

## 4 核心概念

| 术语 | 定义 |
|---|---|
| **事实（Fact）** | 一条 `(subject, predicate, object)` 三元组 + 时间窗 + 状态。object 是标量字符串，不做结构化解析 |
| **当前有效（current）** | `valid_until IS NULL` 的事实；其中 `status='active'` 的才是默认召回对象 |
| **冲突** | 同一 `(subject, predicate)` 下存在 `status IN ('active','decayed')` 且 `valid_until IS NULL` 的事实，且其归一化 object 与新写入的归一化 object 不同 |
| **裁决（Adjudication）** | 一次冲突处理：按策略关闭/降权旧事实、写入新事实、建立关系、追加日志，四件事在同一事务内完成 |
| **时间窗（valid_from / valid_until）** | 事实"在现实世界中为真"的区间；与"系统何时得知"（`created_at`）是两条独立时间轴 |
| **审计轨迹（audit）** | 某 `(subject, predicate)` 的全部事实版本 + 关系 + 裁决日志，按时间还原 |
| **归一化等价** | NFKC + 去首尾空白 + 折叠内部空白 + 大小写折叠后完全相等；**不做语义等价**（"北京" ≠ "北京市"） |

术语的字段级定义见 [03 数据结构](./03-data-model.md)。

## 5 功能需求

### FR-1 写入与冲突检测

- 入参：`subject`(1–200 字符)、`predicate`(slug，1–64)、`object`(1–2000 字符)、可选 `metadata`(≤4KB JSON)、`observedAt`(ISO-8601)、`strategy`、`sourceSession`。
- 写入前按 `(subject, predicate)` 查当前有效事实。
- 无冲突 → 插入 `status='active'`、`weight=1.0`，`action='created'`。
- 与**当前有效事实**的归一化 object 相同 → 不新建，返回既有事实，`action='duplicate'`（幂等）。若新值等于**历史**值但与当前值不同（A→B→A），按正常裁决处理，历史行不复活（[ADR-0005](./08-decisions/adr-0005-adjudication-boundaries.md)）。
- 有冲突 → 进入 [FR-2](#fr-2-三类裁决策略)。
- `observedAt` 早于当前事实的 `valid_from` → 拒绝（`ERR-STATE-002`），v1 不做补写历史。
- 异常与边界逐条定义于 [04](./04-errors-and-edge-cases.md#事实写入边界)。

**验收要点**：无冲突写入可召回；重复写入不产生第二行；冲突写入触发裁决且旧事实状态改变（AC-1）。

### FR-2 三类裁决策略

| 策略 | 语义 | 旧事实 | 新事实 | 关系 |
|---|---|---|---|---|
| **A 取代** `supersede` | 新值取代旧值 | `valid_until=t`、`status='superseded'`、`superseded_by=new` | `valid_from=t`、`active` | `SUPERSEDES` |
| **B 版本化转移** `versioned_transfer` | 角色/关系转移，双方时间线都要保留 | 同行迁移，但保留原 `valid_from`；`status='superseded'` | 同上 | `TRANSFERS_TO` |
| **C 加权衰减** `weighted_decay` | 偏好漂移，旧值降权而非关闭 | 不关闭时间窗；`weight *= decayFactor`；`status='decayed'` | 同上 | `DECAYS_FROM` |

- A/B 共享"关闭旧事实窗口"的机械动作，差异在关系类型与审计语义；C 是真正不同的状态迁移。此设计取舍记录于 [ADR-0002](./08-decisions/adr-0002-tech-stack.md#状态迁移为什么只有两种机械动作)。
- 同一 `(subject, predicate)` 存在多个当前有效事实（数据被外部改写）时，全部按所选策略处理，各建一条关系，但**只写一条**裁决日志（一次写入 = 一次裁决）。
- 策略来源优先级：调用参数 `strategy` > `config.strategies.byPredicate[predicate]` > `config.strategies.default`。

**验收要点**：三类策略各自产生预期状态迁移；`caml-audit` 能还原"现在是谁/之前是谁"（AC-2、AC-4）。

### FR-3 默认召回

- 只返回 `status='active'` 且 `valid_until IS NULL` 且 `weight >= minWeight` 的事实。
- 支持 `subject` / `predicate` / `query`（关键词）过滤，`limit` 1–100（默认 20）。
- 支持 `asOf`（ISO-8601）：返回"在那个时刻为真"的事实（含已关闭窗口的历史事实），用于"去年他在哪家公司"。
- 排序：`weight` 降序 → `valid_from` 降序 → `id` 升序（稳定）。
- 绝不返回 `superseded`；`decayed` 仅在 `includeDecayed=true` 或 `asOf` 查询时返回。

**验收要点**：反例测试——被取代/被衰减的旧值在默认召回中消失（AC-3）。

### FR-4 审计召回

- 入参 `subject` + `predicate`（必填）。
- 返回三段：`timeline`（全部版本，按 `valid_from` 升序）、`adjudications`（裁决日志）、`summary`（当前值、历史条数、首末时间）。
- `timeline` 每项标注 `status`、`weight`、`validFrom/validUntil`、`supersededBy`、关联 `relation` 与 `adjudicationId`。
- 审计不改变任何状态，不写日志。

**验收要点**：能回答"以前是什么/谁"；时间线可逐条对上裁决日志（AC-4）。

### FR-5 策略配置

配置项（schema 见 [02](./02-api-contract.md#配置契约)）：

```yaml
strategies:
  default: supersede              # supersede | versioned_transfer | weighted_decay
  byPredicate: { location: supersede, role: versioned_transfer, preference: weighted_decay }
  decayFactor: 0.5                # 0.05–0.95
  minWeight: 0.3                  # 0–1，召回阈值
storage:
  dbPath: "<workspace>/.dsh-caml/caml.db"
limits:
  maxObjectChars: 2000
  maxMetadataBytes: 4096
```

- 非法值在加载时快速失败（`ERR-CONF-*`），不静默回退。
- 配置只影响后续裁决；不回溯修改既有事实。

**验收要点**：改配置后同一 predicate 的裁决行为随之改变（AC-5）。

### FR-6 工具注册与生命周期

- 通过 `ctx.tools.register` 注册 `caml-remember` / `caml-recall` / `caml-audit`，工具定义含 `description`、JSON Schema `parameters`、`output.schema`、`render`。
- `apply()` 内完成注册；返回的 disposer 在卸载时注销工具并关闭数据库连接。
- 加载失败（DB 不可写/损坏/迁移失败）只记录错误并让本插件 fiber 失败，**不得阻塞宿主启动**。
- 兼容性通过 `engines.dsh` 声明（`>=0.2.1-rc.2 <0.3.0-0`）。

**验收要点**：在 DSH 0.2.1-rc.2 上加载成功且三个工具可见；卸载后工具消失（AC-6）。

### FR-7 裁决日志

每次裁决写一条 `adjudication_log`：`subject`、`predicate`、冲突事实 id 列表、所选策略、结果事实 id、原因（`reason` 为机器可读枚举 + 人类可读说明）、时间。

- 日志只追加，不修改。
- 日志不含完整 object 正文（只留 id 与截断摘要），避免把敏感内容写进审计文件。

**验收要点**：每次 `caml-remember` 触发裁决后日志恰好 +1；日志可经 `caml-audit` 读出（AC-4）。

## 6 非功能性需求

见 [05 非功能性](./05-non-functional.md)：性能指标 NFR-P、容错 NFR-R、兼容 NFR-C、安全 NFR-S、可观测 NFR-O、可维护 NFR-M。

## 7 验证场景与演示脚本

| 场景 | 事实示例 | 策略 | 演示动作 |
|---|---|---|---|
| 求职 | `(我, 目标城市, 杭州)` → `(我, 目标城市, 上海)` | A | 问"我现在想去哪"得上海；问"之前想去哪"得杭州 |
| 企业 | `(支付项目, 负责人, 张三)` → `(支付项目, 负责人, 李四)` | B | 问"现在谁负责"得李四；问"上线前是谁"得张三 |
| 旅游 | `(我, 住宿偏好, 青旅)` → `(我, 酒店)` → `(我, 民宿)` | C | 推荐以民宿为主；问"以前喜欢住哪"用 `asOf` 召回青旅（权重 0.25；`asOf` 不受阈值限制） |

每个场景在 [06 测试](./06-test-plan.md#评测集-et) 中有对应用例；在 [07 验收](./07-acceptance.md) 中有判定命令。

## 8 与现有插件的差异

| 维度 | 现有插件 | CAML |
|---|---|---|
| 冲突处理 | 去重合并 / 手工 supersedes / 归档 | 显式策略 + 确定性状态迁移 |
| 旧事实处置 | 覆盖或共存 | 保留于时间线，默认不召回，审计可查 |
| 可验证性 | 功能演示为主 | 自带评测集与通过标准（AC-1…AC-12） |
| 依赖 | 多数需要向量/模型/服务 | 0 运行时依赖，纯本地 SQLite |

## 9 里程碑

| 阶段 | 内容 | 出口标准 | 预估 |
|---|---|---|---|
| M1 | 插件骨架 + SQLite store + 无冲突写入/召回 | IT-1 通过 | 2–3 天 |
| M2 | 策略 A + 默认/审计召回分流 | TC-2/A、AC-1…AC-4 部分 | 2–3 天 |
| M3 | 策略 B、C + 配置映射 | TC-2/B、TC-2/C、TC-5 | 2–3 天 |
| M4 | 评测集 + 基线对照 + README 通过率 | ET-1…ET-15 全绿 | 2–3 天 |
| M5 | DSH 插件封装验证 + 三场景演示 + 视频 | AC-6、AC-12 | 2–3 天 |

## 10 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 基线插件只实测过 DSH 0.1.7-rc.2 | 移植成本超预期 | M1 第一天做 30 分钟 spike：在 0.2.1-rc.2 上加载并用假 ctx 跑通 `apply()`；失败则退回 [ADR-0001](./08-decisions/adr-0001-base-plugin.md#备选方案) 的备选底座 |
| 评测集规模小，说服力不足 | 面试被质疑 | README 明示规模，强调"可扩展框架"是交付物；每条用例给失败归类 |
| 裁决语义想得比做得多 | 范围蔓延 | NG 清单 + [ADR-0004](./08-decisions/adr-0004-red-lines.md) 红线；新增能力必须新开 ADR |
| 时间窗/时区处理出错 | 隐蔽且致命 | 全部存 epoch ms，边界用例 TC-6 全覆盖 |

## 11 成功定义

v1 成功的唯一标准：**在 DSH 0.2.1-rc.2 上加载本插件，跑完 [07 验收](./07-acceptance.md) 的 AC-1…AC-12 全部通过，且评测集通过率 100%**；同时记录基线插件在同一个评测集上的通过率，作为对照。
