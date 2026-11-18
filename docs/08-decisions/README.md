# 08 · 决策记录（ADR）

> 版本：v1.0 ｜ 状态：冻结候选 ｜ 约束对象：[01 PRD](./../01-prd.md)、[02 API](./../02-api-contract.md)、[03 数据](./../03-data-model.md)

架构决策记录（Architecture Decision Record）回答"为什么是这样做，而不是别的做法"。**任何实现与 ADR 冲突时，要么改实现，要么新开一条 ADR 推翻它——不允许两者并存。**

## 索引

| 编号 | 决策 | 一句话结论 | 影响面 |
|---|---|---|---|
| [ADR-0001](./adr-0001-base-plugin.md) | 改造哪个插件 | fork `AieXile/dsh-memory-plugin@1.6.0`（MIT） | 代码底座、迁移成本、叙事 |
| [ADR-0002](./adr-0002-tech-stack.md) | 技术栈 | TypeScript + `node:sqlite` + 零运行时依赖 + 无 ORM | 全部实现 |
| [ADR-0003](./adr-0003-project-structure.md) | 项目结构 | `domain → store → tools → plugin` 单向依赖 | 代码组织、可测性 |
| [ADR-0004](./adr-0004-red-lines.md) | 红线 | 10 条不可协商约束 | 范围、合规、演示口径 |
| [ADR-0005](./adr-0005-adjudication-boundaries.md) | 边界语义 | 重复判定、日志粒度、库位置、asOf 权重、移除 `includeSuperseded` | 语义契约、测试断言 |
| [ADR-0006](./adr-0006-object-lookup.md) | 按值反查 | `caml-recall` 增加 `object` + `includeHistory`（默认关闭，受控历史查询） | API、评测判定 |

## 模板

每条 ADR 固定五段：**背景**（为什么现在要决定）、**选项**（真实候选 + 淘汰理由）、**决定**、**后果**（好的与坏的，都要写）、**何时重审**（触发条件，不是日期）。

## 决策之间的关系

```
ADR-0001 底座 ──┐
                ├── ADR-0003 结构（底座是单文件，改成模块化）
ADR-0002 技术栈 ┘
                        └── ADR-0004 红线（约束前三者的边界）
```

- ADR-0001 选了一个"零依赖单文件"的底座，ADR-0002 因此选择"不做外部数据库、不上 ORM"。
- ADR-0003 把单文件拆成四层，前提是 ADR-0002 的"领域层纯函数"。
- ADR-0004 把上述三条里**不可谈判**的部分固化，防止范围蔓延。
