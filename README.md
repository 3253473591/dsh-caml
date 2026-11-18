# dsh-caml

CAML（Conflict-Aware Memory Layer）：DSH 记忆插件的**冲突裁决层**——对时间敏感事实的冲突给出显式裁决语义，并附带可自动跑分的评测集。

> 一句话：给 DSH 写了一个会**裁决记忆冲突**的插件——冲突评测 16/16，同类上游插件 0/16。

> 状态：实现完成，tag **`v1.0.0-rc.1`**；之后进入评测扩展（命中率）阶段。**当前进度与路线见 [docs/10-status.md](docs/10-status.md)。** AC-6 已在真实 DSH 0.2.1-rc.2 验证；AC-7 的 `caml-recall` p95 23.8ms 未达 15ms 阈值（准确性优先，已知差距）。

## 结果

| 指标 | 本插件 | 上游 `dsh-memory-plugin@1.6.0` |
|---|---:|---:|
| 冲突评测（16 场景） | **16 / 16** | 0 / 16 |
| 默认召回给出正确当前值 | 16 / 16 | 0 / 16 |
| 能回答"以前是什么" | 16 / 16 | 0 / 16 |

口径与原始数据见 [eval/baseline.md](eval/baseline.md)、[eval/report/report.json](eval/report/report.json)。

## 三个工具

| 工具 | 作用 |
|---|---|
| `caml-remember` | 写入 `(subject, predicate, object)`；冲突时按策略裁决（取代 / 转移 / 衰减） |
| `caml-recall` | 只读，默认只回当前有效事实；`asOf` 查"当时为真" |
| `caml-audit` | 只读，返回完整时间线、裁决记录与当前值 |

```jsonc
// caml-remember
{ "subject": "我", "predicate": "目标城市", "object": "上海" }
// → { action: "superseded", strategy: "supersede",
//     adjudication: { previous: [{ object: "杭州", validUntil: "…" }], relation: "SUPERSEDES" } }
```

## 安装

```bash
# 1) 构建（发布产物在 lib/）
npm install && npm run build

# 2) profile patch 里加一行
#    name 指向本仓库绝对路径
- insert:
    - id: dsh-caml
      name: 'dsh-caml'
```

配置（`cordis.patch.yml` 的 `config`）：

```yaml
config:
  storage:
    # 省略 = $DSH_HOME/caml/caml.db；相对路径相对进程 cwd
    # dbPath: '/absolute/path/caml.db'
  strategies:
    default: supersede
    byPredicate: { role: versioned_transfer, preference: weighted_decay }
    decayFactor: 0.5
    minWeight: 0.3
```

## 三类裁决

| 策略 | 语义 | 旧值 | 关系 |
|---|---|---|---|
| `supersede` | 值被更正/过时 | 关窗 + `superseded` | `SUPERSEDES` |
| `versioned_transfer` | 角色交接 | 关窗 + `superseded` | `TRANSFERS_TO` |
| `weighted_decay` | 偏好漂移 | 不关窗、降权 `decayed` | `DECAYS_FROM` |

## 性能（10,000 条事实，本机 Node 24）

| 指标 | 实测 p95 | 阈值 | 结论 |
|---|---:|---:|---|
| `caml-remember` | 2.6 ms | ≤ 5 ms | ✅ |
| `caml-audit` | 5.7 ms | ≤ 20 ms | ✅ |
| `caml-recall`（无关键词） | 23.8 ms | ≤ 15 ms | ❌ 未达标（p50 7.0 ms；语句缓存后仍高于阈值） |

原始数据 [evidence/AC-7/perf.json](evidence/AC-7/perf.json)。recall 的 p95 未达标是当前已知缺口，未用改阈值的方式掩盖。

## 不做的事

向量/语义检索、LLM 参与裁决、待确认冲突队列、自动注入与面板 UI、多租户、外部数据库/ORM、上游历史数据迁移、多模态与同步。完整清单见 [docs/01-prd.md](docs/01-prd.md#32-明确不做)。

## 文档

- [docs/README.md](docs/README.md) — 索引与需求追踪矩阵
- [docs/09-execution-plan.md](docs/09-execution-plan.md) — M1–M5 与阶段门
- [docs/08-decisions/](docs/08-decisions/README.md) — 5 条 ADR

## 开发

```bash
npm test          # 69 项：单元/集成/属性/规模/故障/评分器
npm run eval      # 16 场景确定性评测 → eval/report/report.json
npm run eval:pv   # 生成 96 条 PV/AB 用例 → eval/pv-cases.json
npm run eval:pv:score -- <records.json>   # 给录制的模型运行打分
npm run perf      # 10k 事实性能测量
```

PV/AB 的**录制**仍靠真实 UI 跑（见 [评测设计](docs/research/2026-11-16-eval-design.md#4-运行协议)）；runner 只做确定性断言与打分，不调用模型。

## 致谢与许可

- 底座：[AieXile/dsh-memory-plugin](https://github.com/AieXile/dsh-memory-plugin) v1.6.0（MIT）——插件外壳、工具注册形态与 `supersedes` 抽象；重写范围见 [NOTICE](NOTICE)。
- 运行时：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）。
- 调研对照：[dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon)、[meow-memory](https://github.com/Phant0Meow/dsh-meow-memory)、[dsh-memory](https://github.com/RestRegular/dsh-memory)、[dsh-git-memory](https://github.com/seriousz158/dsh-memory)、[dsh-peoplememory](https://github.com/whitequeen306/dsh-peoplememory)。
- 许可：MIT，见 [LICENSE](LICENSE)。