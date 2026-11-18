# R3 · 按值反查的设计选项

> 2026-11-18 ｜ 性质：设计对比（**已实现 A 方案**，见 [ADR-0006](../08-decisions/adr-0006-object-lookup.md)）｜ 触发：探针发现 `contradict` 无键类必然 0 分
> 关联：[R2 评测设计](./2026-11-16-eval-design.md)、[02 API](../02-api-contract.md)、[ADR-0005](../08-decisions/adr-0005-adjudication-boundaries.md)

## 问题

探针"我记得是杭州吧？"（提示里没有 subject/predicate 键）时，模型调 `caml-recall` 查不到任何记录，回答"没有相关记忆"。

根因两条：

1. `caml-recall` 需要**坐标**（subject/predicate）才召回；提示里只有**值**。
2. 默认召回只返回 `active`；目标值"杭州"已 `superseded`，即使按值查也查不到。

结果：模型既无法确认"杭州曾经属于哪个坐标"，也无法得知当前值是上海。这不是模型被带偏，是工具面缺能力。

## 目标与非目标

**目标**：让模型能从"一个值"定位到坐标，并同时看到该坐标的当前值与旧值状态；一次调用完成。

**非目标**：不做模糊语义搜索（"北京"≠"北京市"仍成立）；不改变默认召回语义（旧值默认永不出现）；不引入 LLM。

## 选项

### A. 扩展 `caml-recall`：`object` + `includeHistory`

```jsonc
caml-recall({ "object": "杭州", "includeHistory": true, "limit": 10 })
// → facts: [
//   { subject: "我", predicate: "目标城市", object: "杭州",
//     status: "superseded", validUntil: "2026-11-01T..." },
//   { subject: "我", predicate: "目标城市", object: "上海",
//     status: "active", validUntil: null }
// ]
```

- `object`：归一化精确匹配（与 remember 的判等一致），不模糊。
- `includeHistory`：默认 `false`；`true` 时把 `superseded/decayed` 也纳入匹配，并返回 `status` 与时间窗。
- 一次调用同时拿到"旧值属于哪个坐标 + 当前值"，正好回答 `contradict`。

**代价**：API 增量（02 要改）；ADR-0005 曾**移除** `includeSuperseded`，需要新 ADR 说明为何这次加回一个受控版本；SQL 加一个 where 条件即可。

### B. 新工具 `caml-lookup`

```jsonc
caml-lookup({ "object": "杭州" })
// → [{ subject: "我", predicate: "目标城市", object: "杭州", status: "superseded" }]
```

再让模型对命中的坐标调 `caml-audit`。

**代价**：工具数 +1；两轮调用；描述需要防滥用；但 recall 语义完全不变。

### C. 零改动，只改描述

在 `caml-recall` 描述里引导"先无参数列出活跃坐标，再按坐标查"。

**代价**：0；但**查不到旧值**——旧值不在 active 列表里，`contradict` 无键类仍然 0 分，只是把失败理由说得更清楚。

### D. 放宽 `asOf`

不可行：提示里没有时间，模型无法给出 `asOf`。

## 对比

| 维度 | A 扩展 recall | B 新工具 | C 零改动 |
|---|---|---|---|
| 覆盖 `contradict` 无键类 | ✅ 一次调用 | ✅ 两轮调用 | ❌ 仍失败 |
| API 稳定性 | 增量、向后兼容 | 新增工具，零破坏 | 无变化 |
| 实现量 | 小（where + 参数 + 测试） | 中（新工具 + 测试 + 描述） | 0 |
| 模型往返 | 1 次 | 2 次 | 1 次（但查不到） |
| 误用风险 | 中（`includeHistory` 可能被滥用来翻旧账） | 低 | 无 |
| ADR 影响 | 需 ADR-0006（受控历史查询） | 需 ADR-0006（工具面扩张） | 无 |

## 建议

**选 A**，理由：一次调用就能完成"值 → 坐标 → 当前值/旧值"的闭环，正好落在现有 `recall` 的职责（读）里；实现量最小。

但必须配一条硬约束，写进 ADR-0006：

- `includeHistory` 默认 `false`，**默认路径不得返回旧值**；
- 返回的旧值必须带 `status != active`，模型不能把它当当前值；
- 该参数只用于"核对历史"，不参与自动召回/注入；
- `object` 匹配必须与 `remember` 的归一化判等一致（NFKC + 折叠 + casefold）。

## 对评测的影响

`contradict` 无键类的期望改为：

1. 调 `caml-recall({ object: "杭州", includeHistory: true })`；
2. 回答"库里当前是上海，杭州是 11 月前的历史"→ **2 分**；
3. 仍被用户带偏（把杭州当当前）→ **0 分**。

## 验证（2026-11-18，隔离实例）

- 显式调用：`caml-recall(object="杭州", includeHistory=true)` 返回两条（杭州 superseded / 上海 active），模型能正确解读。
- 自然提问第一次失败：模型**完全没调工具**，回答"没有记录"——说明问题是**工具选择**，不是查询能力。
- 修改 `caml-recall` 描述（加入"用户说'我记得…'时先按 object 反查"）并重启后，同一句"我记得是杭州吧？"正确回答：

  > 杭州 superseded（2026-10-01 → 2026-11-01）；上海 active（2026-11-01 → 至今）

结论：A 方案与描述引导都必要；**描述是触发率的一部分**，PV 评测要单独统计工具命中率。

## 已选

已选 **A**，实现见 [ADR-0006](../08-decisions/adr-0006-object-lookup.md) 与 tag `v1.1.0-alpha.1`。
