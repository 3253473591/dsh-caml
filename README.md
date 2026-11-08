# dsh-caml

CAML（Conflict-Aware Memory Layer）：DSH 记忆插件的**冲突裁决层**——对时间敏感事实的冲突给出显式裁决语义，并附带可自动跑分的评测集。

> 状态：**设计阶段**（文档 v1.0.2 已冻结），尚未开始编码。

## 从这里开始

| 文档 | 内容 |
|---|---|
| [docs/README.md](docs/README.md) | 文档索引、ID 约定、需求追踪矩阵 |
| [docs/01-prd.md](docs/01-prd.md) | 产品需求（做什么 / 不做什么 / 里程碑） |
| [docs/02-api-contract.md](docs/02-api-contract.md) | 三个工具契约与状态迁移表 |
| [docs/03-data-model.md](docs/03-data-model.md) | SQLite 表、索引、不变量、时间模型 |
| [docs/04-errors-and-edge-cases.md](docs/04-errors-and-edge-cases.md) | 错误码与边界行为 |
| [docs/05-non-functional.md](docs/05-non-functional.md) | 性能 / 容错 / 兼容 / 安全指标 |
| [docs/06-test-plan.md](docs/06-test-plan.md) | 测试分层与 16 条评测用例 |
| [docs/07-acceptance.md](docs/07-acceptance.md) | AC-1…AC-12 验收标准 |
| [docs/08-decisions/](docs/08-decisions/README.md) | 5 条 ADR（底座 / 技术栈 / 结构 / 红线 / 边界语义） |

## 关键前提

- 运行时：DSH `0.2.1-rc.2`，Node `^22.19.0 || >=24.0.0`。
- 底座：fork [AieXile/dsh-memory-plugin](https://github.com/AieXile/dsh-memory-plugin) v1.6.0（MIT），保留 `LICENSE` 与 `NOTICE`。
- 存储：Node 内置 `node:sqlite`，单文件 + WAL；**零运行时依赖**，不引入 MySQL/PostgreSQL/ORM。
- 工具名：`caml-remember` / `caml-recall` / `caml-audit`。

## 许可

MIT（最终交付时随代码补 `LICENSE` 与上游 `NOTICE`）。
