# CAML 文档集

> 状态：设计冻结候选 v1.0 ｜ 日期：2026-11-08 ｜ 适用运行时：DSH `0.2.1-rc.2` ｜ 基线插件：`dsh-memory-plugin@1.6.0`（MIT）

CAML（Conflict-Aware Memory Layer）是一个 DSH 记忆插件：它把"时间敏感事实的冲突裁决"从隐含行为变成**显式契约**，并让该契约**可被自动评测**。

## 阅读路径

| 你是谁 | 按这个顺序读 |
|---|---|
| 评委 / HR / 面试官 | [01 PRD](./01-prd.md) §1–3 → [07 验收](./07-acceptance.md) → [08 决策](./08-decisions/README.md) |
| 接手开发的工程师 | [03 数据结构](./03-data-model.md) → [02 API](./02-api-contract.md) → [06 测试](./06-test-plan.md) → [04 异常](./04-errors-and-edge-cases.md) |
| 想复现结果的评审 | [07 验收](./07-acceptance.md) → [06 测试](./06-test-plan.md) → `eval/` 目录 |

## 文档地图

| # | 文档 | 回答的问题 | 主要读者 | 状态 |
|---|---|---|---|---|
| 01 | [PRD](./01-prd.md) | 做什么、为什么、不做什么、里程碑 | 全体 | 待评审 |
| 02 | [API 契约](./02-api-contract.md) | 三个工具的入参/出参/状态迁移/注册契约 | 开发、集成方 | 待评审 |
| 03 | [数据结构](./03-data-model.md) | 表、字段、索引、不变量、时间模型、ID | 开发 | 待评审 |
| 04 | [边界与异常](./04-errors-and-edge-cases.md) | 错误码、每个边界的确定行为 | 开发、测试 | 待评审 |
| 05 | [非功能性](./05-non-functional.md) | 性能/容错/兼容/安全/可观测的指标 | 开发、评审 | 待评审 |
| 06 | [测试文档](./06-test-plan.md) | 测什么、怎么测、用例清单 | 开发、测试 | 待评审 |
| 07 | [验收标准](./07-acceptance.md) | 什么算通过、证据是什么 | 评审 | 待评审 |
| 08 | [决策记录](./08-decisions/README.md) | 底座、技术栈、结构、红线的取舍 | 评审、继任者 | 待评审 |
| — | [PRD V0.1](./PRD%20V0.1.md) | 历史草稿（已被 01 取代） | 归档 | 冻结 |

## 全局 ID 约定

文档之间只通过这些 ID 交叉引用，**不用"见上文/见某章"这种模糊指代**。

| 前缀 | 含义 | 定义处 |
|---|---|---|
| `FR-n` | 功能需求 | [01](./01-prd.md#5-功能需求) |
| `NG-n` | 明确不做 | [01](./01-prd.md#32-明确不做) |
| `NFR-<类><n>` | 非功能需求（P 性能 / R 容错 / C 兼容 / S 安全 / O 可观测 / M 可维护） | [05](./05-non-functional.md) |
| `API-<名>` | 工具接口 | [02](./02-api-contract.md) |
| `DS-<表>` | 数据表 | [03](./03-data-model.md) |
| `INV-n` | 数据不变量 | [03](./03-data-model.md#不变量) |
| `ERR-<类>-<n>` | 错误码 | [04](./04-errors-and-edge-cases.md#错误码) |
| `TC-n` / `IT-n` / `PT-n` / `ET-n` / `FT-n` / `LT-n` | 单元/集成/属性/评测/故障/负载用例 | [06](./06-test-plan.md) |
| `AC-n` | 验收条件 | [07](./07-acceptance.md) |
| `ADR-nnnn` | 架构决策 | [08](./08-decisions/README.md) |

## 需求追踪矩阵

每一行都必须能闭环：需求 → 接口 → 数据结构 → 用例 → 验收。空白单元格即文档缺陷。

| 需求 | 接口 | 数据 | 异常 | 用例 | 验收 |
|---|---|---|---|---|---|
| FR-1 写入与冲突检测 | [API-REMEMBER](./02-api-contract.md#api-remember) | [DS-FACTS](./03-data-model.md#ds-facts) | [ERR-INPUT](./04-errors-and-edge-cases.md#输入类) | TC-1, IT-1, ET-1 | AC-1 |
| FR-2 三类裁决 | [API-REMEMBER](./02-api-contract.md#api-remember) | [DS-FACTS](./03-data-model.md#ds-facts), [DS-RELATIONS](./03-data-model.md#ds-relations) | [ERR-STATE](./04-errors-and-edge-cases.md#状态类) | TC-2, PT-1, ET-2 | AC-2, AC-4 |
| FR-3 默认召回 | [API-RECALL](./02-api-contract.md#api-recall) | [INV-1](./03-data-model.md#不变量) | [ERR-INPUT](./04-errors-and-edge-cases.md#输入类) | TC-3, ET-3 | AC-3 |
| FR-4 审计召回 | [API-AUDIT](./02-api-contract.md#api-audit) | [DS-LOG](./03-data-model.md#ds-log) | [ERR-STATE](./04-errors-and-edge-cases.md#状态类) | TC-4, ET-4 | AC-4 |
| FR-5 策略配置 | 配置 schema | [DS-META](./03-data-model.md#ds-meta) | [ERR-CONF](./04-errors-and-edge-cases.md#配置类) | TC-5 | AC-5 |
| FR-6 工具注册与生命周期 | [API-REGISTER](./02-api-contract.md#api-register) | — | [ERR-STORE](./04-errors-and-edge-cases.md#存储类) | IT-2, FT-1 | AC-6 |
| FR-7 裁决日志 | [API-AUDIT](./02-api-contract.md#api-audit) | [DS-LOG](./03-data-model.md#ds-log) | [ERR-INT](./04-errors-and-edge-cases.md#内部类) | IT-3, ET-4 | AC-4 |
| NFR-P 性能 | — | — | — | LT-1 | AC-7 |
| NFR-R 容错 | — | [INV-5](./03-data-model.md#不变量) | [ERR-STORE](./04-errors-and-edge-cases.md#存储类) | FT-1…FT-4 | AC-8 |
| NFR-C 兼容 | [API-REGISTER](./02-api-contract.md#api-register) | — | — | IT-2 | AC-6 |
| NFR-S 安全 | — | — | [ERR-INPUT](./04-errors-and-edge-cases.md#输入类) | TC-6, IT-4 | AC-9 |

## 文档关系

```
01 PRD ──┬── 02 API ──────┬── 03 数据结构 ──── 04 异常
         │                 │
         ├── 05 非功能 ────┴── 06 测试 ──── 07 验收
         │
         └── 08 决策（ADR-0001 底座 / ADR-0002 技术栈 / ADR-0003 结构 / ADR-0004 红线）
```

规则：**02 只能引用 03 定义的类型，03 不能引用 02 的字段名**；**06 的每条用例必须挂到至少一个 FR/AC**；**07 的每条 AC 必须能在 06 找到对应用例**；**任何与 08 冲突的实现，改 08 或改实现，不允许两者并存**。

## 致谢与许可

- **底座**：[AieXile/dsh-memory-plugin](https://github.com/AieXile/dsh-memory-plugin) v1.6.0（MIT）。插件外壳、工具注册形态与 `status/supersedes` 抽象来自该项目；本仓库重写了存储层与裁决层，取舍见 [ADR-0001](./08-decisions/adr-0001-base-plugin.md)。
- **运行时**：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）。Cordis 插件模型、工具协议与 `node:sqlite` 存储实践均以官方文档为准。
- **调研对象**（只做对照，未复制代码）：[dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon)、[meow-memory](https://github.com/Phant0Meow/dsh-meow-memory)、[dsh-memory](https://github.com/RestRegular/dsh-memory)、[dsh-git-memory](https://github.com/seriousz158/dsh-memory)、[dsh-peoplememory](https://github.com/whitequeen306/dsh-peoplememory)。
- **许可**：本仓库沿用 MIT，保留上游 `LICENSE` 与 `NOTICE`；包名 `dsh-caml`、工具名前缀 `caml-`，与上游明确区分，避免混淆。

## 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-08 | v1.0 | 拆分为 9 份文档 + 4 条 ADR；新增追踪矩阵；PRD V0.1 降为历史 |
| 2026-11-08 | v1.0.1 | 工具名统一 `caml-` 前缀；补命名约定、致谢与"无 UI 半边"验收项 |
| 2026-11-08 | v1.0.2 | 依独立评审补齐边界语义（ADR-0005）：重复判定范围、日志粒度、库位置、`asOf` 阈值、移除 `includeSuperseded`；评测集 16 条 |
