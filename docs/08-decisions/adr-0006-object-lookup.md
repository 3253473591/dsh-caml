# ADR-0006 · 受控的按值反查

> 状态：已接受 ｜ 日期：2026-11-18 ｜ 影响：[02 API](./../02-api-contract.md)、[R3 设计](./../research/2026-11-18-lookup-by-value.md)

## 背景

探针显示：提示里只有值、没有 `subject/predicate` 键时（"我记得是杭州吧？"），模型无法定位坐标，也看不到当前值；默认召回只返回 active，旧值查不到。结果 `contradict` 无键类必然 0 分——这是工具面缺陷，不是模型问题。

[ADR-0005](./adr-0005-adjudication-boundaries.md#d5-移除-includesuperseded) 曾移除 `includeSuperseded`，因为它是"永远不起作用的开关"。这次要求不同：需要**按值定位坐标并核对历史**，且必须防止旧值污染默认路径。

## 决定

在 `caml-recall` 上增加两个可选参数：

| 参数 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `object` | string | 无 | 按值查询：归一化 + casefold 后**精确**匹配，不做模糊/语义匹配 |
| `includeHistory` | boolean | `false` | `true` 时允许匹配历史版本，并把命中值所属坐标的**全部版本**一起返回（一次调用拿到"旧值属于谁 + 当前是谁"） |

硬约束（违反即视为回归）：

1. `includeHistory` 默认 `false`；默认路径**永不**返回 `superseded/decayed`。
2. `includeHistory=true` 的结果必须带 `status` 与时间窗，模型不得把非 `active` 当当前值。
3. 历史查询**不参与**自动召回/注入，只用于显式核对。
4. `object` 判等与 `remember` 完全一致（NFKC + 折叠 + casefold）；不做"北京=北京市"。
5. `includeHistory=true` 时不应用默认 `minWeight`（历史不该被当前阈值过滤），显式传入仍生效。
6. `asOf` 与 `includeHistory` 同时出现时，`asOf` 优先，`includeHistory` 被忽略。

## 选项与淘汰

| 方案 | 淘汰/采纳理由 |
|---|---|
| B 新工具 `caml-lookup` | 多一轮往返；工具数 +1；A 已能覆盖 |
| C 只改描述 | 旧值不在 active 里，查不到，等于不解决 |
| D 放宽 `asOf` | 提示里没有时间，无法使用 |

## 后果

- 优点：`contradict` 无键类从"必然 0 分"变成可判定；仍保持默认召回干净。
- 代价：`caml-recall` 参数增至 8 个，描述需明确"按值查 + 核对历史"用法；02 文档更新。
- 风险：模型可能用 `includeHistory` 翻旧账并误当当前值 → 由 `status` 字段 + rubric 约束（把旧值当当前 = 0 分）。

## 何时重审

- 评测显示模型滥用 `includeHistory`（默认路径旧值泄漏率 > 0）；
- 需要模糊/语义反查（当前明确不做）。
