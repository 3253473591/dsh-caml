# 上游基线对照（ET-B）

> 状态：**已执行**（2026-11-09）｜ 关联：[06 测试](../docs/06-test-plan.md#基线对照-et-b)、[07 AC-11](../docs/07-acceptance.md)

## 结果

| 指标 | 上游 1.6.0 | 本插件 |
|---|---:|---:|
| 当前值正确率（结果含新值且不含旧值） | **0/16** | 16/16 |
| 历史可回答率（工具能返回旧值作为历史） | **0/16** | 16/16（`caml-audit` / `asOf`） |

环境：Node 24.22.1 / win32 / 假 Cordis ctx（与上游 `test/host-harness.mjs` 同形），命令 `node scripts/baseline-upstream.mjs .tmp/base`。原始数据见 `eval/baseline.json`。

口径说明：基线**未使用**上游的手工 `supersedes` 能力（那需要人工逐条干预，不是"同一场景自动裁决"）；上游检索把新旧值同时作为当前结果返回，因此当前值正确率为 0。两个口径不可直接相加，README 必须并列披露。

## 为什么要单独跑

上游 `AieXile/dsh-memory-plugin@1.6.0` 只在 DSH `0.1.7-rc.2` 实测过；本插件目标运行时是 `0.2.1-rc.2`。把上游装进当前 profile 有污染风险，因此基线在**隔离环境**跑一次，结果只作为对照，不进入 `npm run eval` 的默认路径（[ADR-0005 D7](../docs/08-decisions/adr-0005-adjudication-boundaries.md)）。

## 方法

对 16 条评测场景各做一次：

1. 在上游插件里写入旧值（`memory_add`，把三元组压成内容字符串）。
2. 写入新值（`memory_add`）。
3. 用关键词调用 `memory_search`。

统计两个指标：

| 指标 | 判定 |
|---|---|
| 当前值正确率 | 搜索结果含期望新值，且不含旧值 |
| 历史可回答率 | 任一工具能返回旧值（上游无 audit，预计为 0） |

## 命令（隔离环境）

```bash
# 独立目录 + 独立 DSH profile，避免污染主环境
mkdir -p ~/caml-baseline && cd ~/caml-baseline
npm init -y
npm i @deepseek-ai/dsh@0.1.7-rc.2 dsh-memory-plugin@1.6.0
# 用上游自带 harness 驱动 apply()，按上面的三步脚本记录结果
node baseline-runner.mjs > eval-baseline.json
```

## 结果落点

- `eval/baseline.json`：`{ "environment": "...", "command": "...", "currentValueAccuracy": "n/16", "historyAnswerable": "n/16", "cases": [...] }`
- README 必须并列本插件 16/16 与上面两个数字，并注明"口径不同，不可直接相加"。

## 阻塞说明

未执行前，AC-11 只能算部分满足（本插件侧完成）。G4 门要求该文件存在，因此 G4 暂不打 tag。
