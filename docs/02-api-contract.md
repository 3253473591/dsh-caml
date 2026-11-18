# 02 · API 契约

> 版本：v1.0 ｜ 状态：冻结候选 ｜ 上游需求：[01 PRD](./01-prd.md) ｜ 类型与表定义：[03 数据结构](./03-data-model.md) ｜ 错误码：[04](./04-errors-and-edge-cases.md#错误码)

本文件是**唯一**的接口事实来源。字段名、类型、默认值、错误行为以本文件为准；实现与本文冲突时改实现。类型定义只出现在 [03](./03-data-model.md)，本文只引用不重定义。

## 总则

| 项 | 约定 |
|---|---|
| 调用方式 | DSH 工具调用（`ctx.tools.register`），非 HTTP、非 MCP |
| 工具名 | `caml-remember` / `caml-recall` / `caml-audit`（统一前缀；见[命名约定](#命名约定)） |
| 编码 | UTF-8；入参在进入领域层前做 NFKC 归一化 |
| 时间入参 | ISO-8601 字符串（含时区偏移或 `Z`）；内部一律转 **epoch 毫秒（UTC）** |
| 时间出参 | ISO-8601 UTC 字符串（`2026-11-08T15:00:00.000Z`） |
| 数值 | `weight ∈ [0,1]`，保留 4 位小数；`limit ∈ [1,100]` |
| 未知字段 | **拒绝**（`ERR-INPUT-006`），不静默忽略 |
| 错误 | 抛结构化错误，见 [04](./04-errors-and-edge-cases.md#错误对象)；不返回 `{ok:false}` |
| 幂等 | 与**当前有效事实**的 `(subject, predicate, 归一化 object)` 相同且无时间推进时，重试安全（见 [API-REMEMBER](#api-remember)） |
| 版本化 | v1 字段冻结；新增字段必须可选且有默认；删除/改名视为破坏性变更，需新 ADR |

## 命名约定

| 对象 | 规则 | 示例 |
|---|---|---|
| 包名 | `dsh-caml` | `dsh plugin add dsh-caml` |
| 工具名 | `caml-` + 动作，全小写，连字符 | `caml-remember` |
| 文档 ID | `API-REMEMBER` 等，仅用于文档内引用 | 与工具名不是一回事 |
| 表名 / 字段 | 小写蛇形 | `fact_relations` |
| 错误码 | `ERR-<类>-<序号>` | `ERR-STORE-002` |
| 测试 ID | `TC-n` / `IT-n` / `ET-n` … | `ET-C-02` |

DSH 的工具注册不限制名称字符集；在 Code Mode 中，非标识符名称以带引号的属性访问呈现（`tools["caml-remember"](arg)`），不影响调用。

## 工具注册契约 <a id="api-register"></a>

每个工具向 `ctx.tools.register` 提交：

```ts
interface ToolRegistration {
  name: 'caml-remember' | 'caml-recall' | 'caml-audit'
  description: string            // 何时用、何时不用，各一句
  parameters: JSONSchema         // 见各 API 的 parameters
  output: { schema: JSONSchema, render: (value) => string }  // 结构化输出 + 人读渲染
  execute: (args, ctx) => Promise<Output>
}
```

- `description` 必须写明"会改变记忆状态"（`caml-remember`）与"只读"（`caml-recall`/`caml-audit`），避免模型误用。
- `render` 只做人读排版（Markdown 列表/时间线），**不得引入新语义**；模型判断以 `output` 为准。
- 注册在 `apply()` 内同步完成；返回 disposer 在插件卸载时注销工具并 `store.close()`。
- 工具名重复由 DSH 注册表裁决（后者失败）。统一 `caml-` 前缀已把冲突概率降到可忽略；若仍冲突，在 profile 中禁用冲突插件并在 README 记录。

## API-REMEMBER（`caml-remember`） <a id="api-remember"></a>

**用途**：写入一条事实；若同一 `(subject, predicate)` 已有当前有效事实且 object 不同，按策略裁决。

### 入参

| 字段 | 类型 | 必填 | 约束 | 默认 |
|---|---|---|---|---|
| `subject` | string | 是 | 归一化后 1–200 字符 | — |
| `predicate` | string | 是 | `^[\p{L}][\p{L}\p{N}_.-]{0,63}$`（Unicode 字母开头，区分大小写） | — |
| `object` | string | 是 | 归一化后 1–2000 字符 | — |
| `metadata` | object | 否 | JSON 序列化 ≤ 4096 字节；值不限深度但不得含循环引用（JSON 本身保证） | 无 |
| `observedAt` | string(ISO) | 否 | 不得晚于 `now + 5min`；必须**严格晚于**当前有效事实的 `valid_from` | `now` |
| `strategy` | enum | 否 | `supersede` \| `versioned_transfer` \| `weighted_decay` | 按 [FR-5](./01-prd.md#fr-5-策略配置) 映射 |
| `sourceSession` | string | 否 | 1–128 字符 | 由运行时注入 |

### 返回

```jsonc
{
  "fact": {                      // FactView，见 03
    "id": "f_lx2k9c0a_7d3f1b2c9e",
    "subject": "我", "predicate": "目标城市", "object": "上海",
    "status": "active", "weight": 1.0,
    "validFrom": "2026-11-08T15:00:00.000Z", "validUntil": null,
    "supersededBy": null, "createdAt": "2026-11-08T15:00:00.000Z"
  },
  "action": "superseded",        // created | duplicate | superseded | transferred | decayed
  "strategy": "supersede",       // 无冲突时为 null
  "adjudication": {              // 无冲突时为 null
    "id": "a_lx2k9c0a_1a2b3c4d",
    "previous": [
      { "id": "f_lx2k8zz1_9a8b7c6d5e", "object": "杭州", "weight": 1.0,
        "validFrom": "2026-10-01T00:00:00.000Z", "validUntil": "2026-11-08T15:00:00.000Z" }
    ],
    "relation": "SUPERSEDES"     // SUPERSEDES | TRANSFERS_TO | DECAYS_FROM
  }
}
```

### 状态迁移（唯一权威表） <a id="状态迁移唯一权威表"></a>

| 输入情况 | 旧事实变化 | 新事实 | `action` | 关系 |
|---|---|---|---|---|
| 无当前有效事实 | — | active | `created` | — |
| 与**当前有效事实**的归一化 object 相同 | 不变 | 不写入，返回旧事实 | `duplicate` | — |
| 冲突 + `supersede` | `valid_until=t`、`superseded`、`superseded_by` | active | `superseded` | `SUPERSEDES` |
| 冲突 + `versioned_transfer` | 同上 | active | `transferred` | `TRANSFERS_TO` |
| 冲突 + `weighted_decay` | `weight*=decayFactor`、`decayed`、窗口不动 | active | `decayed` | `DECAYS_FROM` |

> 旧的 `decayed` 事实再次遇到冲突时，继续按同一策略处理（C 再乘一次系数；A/B 直接关闭窗口转 `superseded`）。
>
> `duplicate` 只与**当前有效事实**比较：新值等于已被取代的历史值（A→B→A）仍是一次正常裁决，新建版本，历史行不复活。同一坐标存在多条当前有效事实时（仅外部改写可达），一次写入仍只写**一条**裁决日志，`conflict_fact_ids` 列出全部旧事实，各旧事实各建一条关系。以上两条见 [ADR-0005](./08-decisions/adr-0005-adjudication-boundaries.md)。

### 幂等与重试

- `duplicate` 是幂等结果，不产生新行、不写日志。
- 网络/宿主重试导致同一请求执行两次：第二次因 object 相同返回 `duplicate`，不会重复裁决。
- 事务失败（[ERR-STORE](./04-errors-and-edge-cases.md#存储类)）时整笔回滚，可安全重试。

### render 示例

```
已记住：我 · 目标城市 = 上海（active，权重 1.0）
裁决：supersede（SUPERSEDES）｜旧值：杭州（2026-10-01 ~ 2026-11-08）
```

## API-RECALL（`caml-recall`） <a id="api-recall"></a>

**用途**：只读。返回默认召回集合；支持按 `asOf` 做"当时为真"的历史查询。

### 入参

| 字段 | 类型 | 必填 | 约束 | 默认 |
|---|---|---|---|---|
| `subject` | string | 否 | 归一化后精确匹配 | 不限 |
| `predicate` | string | 否 | 精确匹配 | 不限 |
| `query` | string | 否 | 1–200 字符；对 `subject`/`object` 做大小写不敏感子串匹配（`LIKE`，转义 `%` `_`） | 无 |
| `object` | string | 否 | 按值精确反查（NFKC + 折叠 + casefold，与 remember 判等一致）；可与 subject/predicate 组合 | 无 |
| `includeHistory` | boolean | 否 | `true` 时返回命中坐标的全部版本（带 status）；仅用于核对历史 | `false` |
| `asOf` | string(ISO) | 否 | 任意合法时间；未来时间按 `now` 处理 | 无 |
| `includeDecayed` | boolean | 否 | 是否返回被衰减但窗口未关的事实 | `false` |
| `minWeight` | number | 否 | `[0,1]`；不给则用配置值。`asOf` 查询**默认不应用**阈值，显式传入才生效 | 配置 `minWeight` |
| `limit` | integer | 否 | `[1,100]` | `20` |

### 返回

```jsonc
{
  "facts": [ /* FactView[]，见 03 */ ],
  "count": 1,
  "truncated": false,          // true = 命中数超过 limit
  "asOf": null                 // 回显生效的 asOf（ISO）或 null
}
```

### 过滤语义（按顺序）

1. **时间**：无 `asOf` → `valid_until IS NULL`；有 `asOf` → `valid_from <= T AND (valid_until IS NULL OR valid_until > T)`。
2. **状态**：无 `asOf` → `status='active'`；有 `asOf` → 不限状态（历史就是历史）。
3. **衰减**：`includeDecayed=false` 时排除 `status='decayed'`（`asOf` 查询不受此限）。
4. **权重**：无 `asOf` 时应用 `minWeight`；有 `asOf` 时仅当调用方显式传 `minWeight` 才过滤。
5. **关键词**：`query` 命中 `subject` 或 `object`。
6. **排序**：`weight DESC, valid_from DESC, id ASC`。
7. **截断**：取前 `limit` 条；`count` 为返回条数，`truncated` 表示是否还有更多。

**按值反查（独立路径）**：传 `object` 时按归一化精确匹配；未传 `includeHistory` 时只返回 active 匹配项（通常 0 或 1 条）。传 `includeHistory: true` 时：先按值命中坐标，再展开该 `(subject, predicate)` 的**全部版本**（按 `valid_from` 升序），结果带 `status` 与时间窗；此路径不应用默认 `minWeight`，显式传入仍生效；与 `asOf` 同时出现时 `asOf` 优先。设计依据见 [ADR-0006](./08-decisions/adr-0006-object-lookup.md)。

### render 示例

```
召回 2 条（按权重）：
1. [active] 我 · 目标城市 = 上海（1.00，2026-11-08 起）
2. [active] 我 · 目标岗位 = 数据工程（1.00，2026-10-20 起）
```

## API-AUDIT（`caml-audit`） <a id="api-audit"></a>

**用途**：只读。还原某 `(subject, predicate)` 的完整版本链、裁决记录与当前值。

### 入参

| 字段 | 类型 | 必填 | 约束 | 默认 |
|---|---|---|---|---|
| `subject` | string | 是 | 归一化后精确匹配 | — |
| `predicate` | string | 是 | 精确匹配 | — |
| `limit` | integer | 否 | `[1,200]`，作用于 `timeline` 与 `adjudications` 各自的条数 | `100` |

### 返回

```jsonc
{
  "subject": "支付项目", "predicate": "负责人",
  "summary": {
    "current": { /* FactView */ },
    "versions": 3,
    "firstAt": "2026-09-01T00:00:00.000Z",
    "lastAt": "2026-11-08T15:00:00.000Z"
  },
  "timeline": [
    { /* FactView */, "relation": "TRANSFERS_TO", "adjudicationId": "a_..." }
  ],
  "adjudications": [
    {
      "id": "a_...", "at": "2026-11-08T15:00:00.000Z",
      "strategy": "versioned_transfer",
      "previousIds": ["f_..."],
      "resultFactId": "f_...",
      "reason": "new_value"
    }
  ],
  "truncated": { "timeline": false, "adjudications": false }
}
```

- `timeline` 按 `valid_from ASC, id ASC`；`adjudications` 按 `created_at ASC`。
- 首条事实没有 `relation`/`adjudicationId`（为 `null`）。
- 无任何事实时返回 `timeline: []`、`adjudications: []`、`summary.current: null`（**不是错误**）。

### render 示例

```
支付项目 · 负责人（3 个版本）
2026-09-01 ~ 2026-10-15  张三  [superseded → 李四]
2026-10-15 ~ 2026-11-08  李四  [superseded → 王五]
2026-11-08 ~ 现在        王五  [active]
裁决 2 次：TRANSFERS_TO ×2（最近：2026-11-08，new_value）
```

## 配置契约

配置在 `cordis.patch.yml` 的 `config` 下；非法配置**加载即失败**（`ERR-CONF-001`），不静默回退。

```yaml
- id: dsh-caml
  name: 'dsh-caml'
  config:
    storage:
      # 省略 = $DSH_HOME/caml/caml.db；绝对路径直接用；相对路径相对插件加载时的进程 cwd
      # dbPath: '/absolute/path/caml.db'
    strategies:
      default: supersede
      byPredicate: {}                  # 例：{ location: supersede, role: versioned_transfer, preference: weighted_decay }
      decayFactor: 0.5                 # [0.05, 0.95]
      minWeight: 0.3                   # [0, 1]
    limits:
      maxObjectChars: 2000             # [64, 8000]
      maxMetadataBytes: 4096           # [256, 65536]
    time:
      futureSkewMs: 300000             # observedAt 允许的未来偏差
```

| 字段 | 类型 | 默认 | 校验 |
|---|---|---|---|
| `storage.dbPath` | string | `$DSH_HOME/caml/caml.db`（无 `DSH_HOME` 时 `<cwd>/.dsh-caml/caml.db`） | 绝对路径直接用；相对路径相对插件加载时的 `process.cwd()`；一进程一库、全会话共享；目录不可写 → `ERR-STORE-001` |
| `strategies.default` | enum | `supersede` | 三选一 |
| `strategies.byPredicate` | map<string, enum> | `{}` | key 必须匹配 predicate 正则 |
| `strategies.decayFactor` | number | `0.5` | `[0.05,0.95]` |
| `strategies.minWeight` | number | `0.3` | `[0,1]` |
| `limits.maxObjectChars` | integer | `2000` | `[64,8000]` |
| `limits.maxMetadataBytes` | integer | `4096` | `[256,65536]` |
| `time.futureSkewMs` | integer | `300000` | `[0, 86400000]` |

## 交叉引用

- 字段类型与表结构：[03](./03-data-model.md)
- 每个错误码的触发条件与用户可见文案：[04](./04-errors-and-edge-cases.md)
- 参数的性能预算：[05](./05-non-functional.md#nfr-p-性能)
- 对应测试：[06](./06-test-plan.md)；验收：[07](./07-acceptance.md)
- 为什么只有两个机械动作、为什么不用 MCP/HTTP：[ADR-0002](./08-decisions/adr-0002-tech-stack.md)
