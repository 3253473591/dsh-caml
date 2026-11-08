# 03 · 数据结构

> 版本：v1.0 ｜ 状态：冻结候选 ｜ 存储引擎决策：[ADR-0002](./08-decisions/adr-0002-tech-stack.md) ｜ 接口引用：[02](./02-api-contract.md)

## 存储引擎

- **嵌入式 SQLite**（`node:sqlite`，Node 内置），单文件，WAL 模式。
- 不使用 ORM、不引迁移框架、不使用 `ctx.storageDomain`（它是 KV、无跨记录事务）。
- 数据库路径：绝对路径直接用；相对路径相对**插件加载时的 `process.cwd()`**；缺省 `$DSH_HOME/caml/caml.db`。**一个进程只开一个库实例，所有会话共享**（按工作区分库见 [NG-5](./01-prd.md#32-明确不做)）。详见 [ADR-0005](./08-decisions/adr-0005-adjudication-boundaries.md)。

## 表清单

| 表 | 作用 | 行数级 |
|---|---|---|
| [DS-FACTS](#ds-facts) | 事实（当前 + 历史版本） | 10³–10⁴ |
| [DS-RELATIONS](#ds-relations) | 新事实与旧事实的关系 | 同 DS-FACTS 同量级 |
| [DS-LOG](#ds-log) | 裁决日志（只追加） | = 裁决次数 |
| [DS-META](#ds-meta) | 元信息（schema 版本、插件版本） | 个位数 |

## DDL（权威）

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 2000;

CREATE TABLE facts (
  id             TEXT PRIMARY KEY,
  subject        TEXT NOT NULL,
  predicate      TEXT NOT NULL,
  object         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active','superseded','decayed')),
  weight         REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0 AND weight <= 1.0),
  valid_from     INTEGER NOT NULL,          -- epoch ms, UTC
  valid_until    INTEGER,                   -- NULL = 仍为真
  superseded_by  TEXT REFERENCES facts(id),
  created_at     INTEGER NOT NULL,          -- 系统得知时间
  source_session TEXT,
  metadata       TEXT,                      -- JSON 文本，可空
  CHECK (valid_until IS NULL OR valid_until > valid_from)
) STRICT;

CREATE UNIQUE INDEX ux_facts_one_active
  ON facts(subject, predicate)
  WHERE status = 'active' AND valid_until IS NULL;

CREATE INDEX ix_facts_pair        ON facts(subject, predicate);
CREATE INDEX ix_facts_current     ON facts(status, valid_until);
CREATE INDEX ix_facts_valid_from  ON facts(valid_from);

CREATE TABLE fact_relations (
  from_fact_id  TEXT NOT NULL REFERENCES facts(id),   -- 新事实
  to_fact_id    TEXT NOT NULL REFERENCES facts(id),   -- 旧事实
  relation_type TEXT NOT NULL CHECK (relation_type IN ('SUPERSEDES','TRANSFERS_TO','DECAYS_FROM')),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (from_fact_id, to_fact_id, relation_type)
) STRICT;

CREATE INDEX ix_rel_to ON fact_relations(to_fact_id);

CREATE TABLE adjudication_log (
  id                TEXT PRIMARY KEY,
  subject           TEXT NOT NULL,
  predicate         TEXT NOT NULL,
  conflict_fact_ids TEXT NOT NULL,   -- JSON 数组，如 ["f_..","f_.."]
  chosen_strategy   TEXT NOT NULL CHECK (chosen_strategy IN ('supersede','versioned_transfer','weighted_decay')),
  result_fact_id    TEXT NOT NULL REFERENCES facts(id),
  reason            TEXT NOT NULL,   -- 机器可读：new_value | duplicate | decayed_below_threshold | ...
  created_at        INTEGER NOT NULL
) STRICT;

CREATE INDEX ix_log_pair ON adjudication_log(subject, predicate, created_at);

CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
```

> `STRICT` 要求 SQLite ≥ 3.37；`node:sqlite` 自带版本满足。若某环境不满足，去掉 `STRICT` 但保留全部 `CHECK`（记录在 README 的兼容性小节）。

## 表定义

### DS-FACTS <a id="ds-facts"></a>

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PK，`f_` 前缀 | 见 [ID 规范](#id-规范) |
| `subject` | TEXT | NOT NULL | 归一化后的主体（如"我""支付项目"） |
| `predicate` | TEXT | NOT NULL，slug | 谓词；策略映射的键 |
| `object` | TEXT | NOT NULL | 归一化后的值（**保留原始大小写**，仅折叠空白） |
| `status` | TEXT | CHECK 三值 | `active` / `superseded` / `decayed` |
| `weight` | REAL | `[0,1]` | 召回排序与阈值；C 策略会乘系数 |
| `valid_from` | INTEGER | NOT NULL | 事实开始为真 |
| `valid_until` | INTEGER | 可空 | `NULL` = 仍为真 |
| `superseded_by` | TEXT | FK | 指向取代它的新事实 |
| `created_at` | INTEGER | NOT NULL | 系统写入时间（事务时间） |
| `source_session` | TEXT | 可空 | 写入来源，便于排查 |
| `metadata` | TEXT | 可空 | 原样 JSON，不参与检索 |

### DS-RELATIONS <a id="ds-relations"></a>

方向约定：**`from_fact_id` = 新事实，`to_fact_id` = 旧事实**；`relation_type` 描述"新事实如何对待旧事实"。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `from_fact_id` | TEXT | FK，与 `to`、`type` 组成 PK | 新事实 |
| `to_fact_id` | TEXT | FK | 旧事实 |
| `relation_type` | TEXT | CHECK | `SUPERSEDES` / `TRANSFERS_TO` / `DECAYS_FROM` |
| `created_at` | INTEGER | NOT NULL | 关系建立时间 |

### DS-LOG <a id="ds-log"></a>

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PK，`a_` 前缀 | 裁决 id |
| `subject` / `predicate` | TEXT | NOT NULL | 冲突坐标（冗余存储，便于按坐标查） |
| `conflict_fact_ids` | TEXT | NOT NULL | JSON 数组，被处理的旧事实 id |
| `chosen_strategy` | TEXT | CHECK 三值 | 实际生效策略（已含覆盖逻辑） |
| `result_fact_id` | TEXT | FK | 本次写入的新事实 |
| `reason` | TEXT | NOT NULL | 机器可读原因；`new_value` 为常规冲突 |
| `created_at` | INTEGER | NOT NULL | 裁决时间 |

**日志不写 object 正文**，只写 id 与原因；正文可从 `DS-FACTS` 按 id 取，避免审计文件重复存敏感内容（[NFR-S-3](./05-non-functional.md#nfr-s-安全与隐私)）。

### DS-META <a id="ds-meta"></a>

| key | value 示例 | 用途 |
|---|---|---|
| `schema_version` | `1` | 与 `PRAGMA user_version` 双写，便于人工核对 |
| `plugin_version` | `0.1.0` | 排查用 |
| `created_at` | `1793836800000` | 首次建库时间 |

## 不变量 <a id="不变量"></a>

| 编号 | 不变量 | 强制方式 |
|---|---|---|
| INV-1 | 同一 `(subject, predicate)` 至多一条 `active` 且窗口未关的事实 | `ux_facts_one_active` 唯一部分索引 |
| INV-2 | `status='active'` ⇒ `valid_until IS NULL` 且 `superseded_by IS NULL` | 应用层写入 + 事务内校验 |
| INV-3 | `status='superseded'` ⇒ `valid_until` 与 `superseded_by` 均非空 | 应用层写入 |
| INV-4 | `status='decayed'` ⇒ 窗口仍开着（`valid_until IS NULL`）且 `superseded_by IS NULL` | 应用层写入 |
| INV-5 | 一次裁决 = 关旧 + 插新 + 建关系 + 写日志，四者同事务 | `BEGIN IMMEDIATE … COMMIT` |
| INV-6 | `valid_until IS NULL OR valid_until > valid_from` | 表级 `CHECK` |
| INV-7 | 每条 `fact_relations` 的两端都存在，且 `from` 的 `created_at >= to` 的 `created_at` | FK + 应用层写入 |

违反 INV-1/2/3/4（外部改写数据库导致）时：`caml-remember` 返回 `ERR-STATE-001`，`caml-recall`/`caml-audit` 仍可用；修复步骤见 [04](./04-errors-and-edge-cases.md#状态类)。

## 时间模型

两条时间轴，分开存、分开用：

| 轴 | 字段 | 回答的问题 |
|---|---|---|
| **有效时间**（valid time） | `valid_from` / `valid_until` | 这件事在现实世界何时为真 |
| **事务时间**（transaction time） | `created_at` | 系统何时得知/写入 |

规则：

1. 全部存 epoch ms（UTC），无时区歧义；入参 ISO 必须带偏移或 `Z`，否则 `ERR-INPUT-003`。
2. `now` 取服务器时钟；`observedAt` 缺省等于 `now`。
3. `observedAt` 晚于 `now + futureSkewMs` → `ERR-INPUT-004`（未来时间不裁决）。
4. `observedAt` 早于当前有效事实的 `valid_from` → `ERR-STATE-002`（v1 不支持补写历史，避免窗口交叠）。
5. `asOf` 查询：`valid_from <= T AND (valid_until IS NULL OR valid_until > T)`；边界取"左闭右开"。
6. 相等时间戳：`valid_until == 新事实.valid_from` 合法（交接点）；`valid_until <= valid_from` 由 CHECK 拒绝。

## 状态机 <a id="状态机"></a>

```
            ┌────────────── caml-remember(无冲突) ──────────────┐
            ▼                                              │
        [active] ── A/B 冲突 ──────────────► [superseded] (终态)
            │
            └── C 冲突 ──► [decayed] ── C 再次冲突 ──► [decayed]（weight *= factor）
                             │
                             └── A/B 覆盖（strategy override）──► [superseded]
```

- `superseded` 是终态：v1 不支持"撤销取代"（需要新事实 + 审计即可表达）。
- `duplicate` 只与**当前有效事实**比较；写回历史值会生成新版本，不是 no-op（[ADR-0005](./08-decisions/adr-0005-adjudication-boundaries.md)）。
- `decayed` 可以再次衰减，也可以在后续 `caml-remember` 显式指定 A/B 时被关闭窗口。
- 任何迁移都伴随一条 `DS-RELATIONS` 与一条 `DS-LOG`（`duplicate` 除外）。

## ID 规范 <a id="id-规范"></a>

| 对象 | 格式 | 示例 |
|---|---|---|
| 事实 | `f_` + 9 位 base36 毫秒时间 + `_` + 10 位 `[a-z0-9]` 随机 | `f_lx2k9c0a_7d3f1b2c9e` |
| 裁决 | `a_` + 同上 | `a_lx2k9c0a_1a2b3c4d` |

- 生成：`Date.now().toString(36).padStart(9,'0')` + `crypto.randomUUID().replace(/-/g,'').slice(0,10)`。
- **仅用于可读与粗排**，排序权威始终是 `valid_from` / `weight` / `id` 的组合键，不得依赖 id 字典序做业务判断。
- id 全局唯一（随机 10 位冲突概率可忽略）；不做自增，避免多进程写入争用。

## 归一化规则

| 对象 | 规则 |
|---|---|
| `subject` / `object` | NFKC → trim → 内部连续空白折叠为单个空格 → **保留大小写** |
| `predicate` | NFKC → trim → 正则校验（Unicode 字母/数字/`_`/`.`/`-`，不转小写，策略键区分大小写） |
| 冲突比较 | 对 `subject`/`predicate` 用归一化后值；`object` 用 **casefold + 折叠后** 比较（"Shanghai" 与 "shanghai" 视为同一值） |
| 存储 | 存归一化后的 `subject`/`predicate`；`object` 存归一化（NFKC/trim/折叠）但**不做 casefold**，保留用户原始大小写 |
| 不做 | 同义词、别名、拼音、简繁转换、单位换算（属 NG-1 语义等价的范畴） |

## 迁移与版本

- `PRAGMA user_version`：`0` = 新库（建表全量），`1` = 当前版本。
- 打开流程：读 `user_version` → `0` 则 `BEGIN; DDL; PRAGMA user_version=1; COMMIT`；`1` 则直接使用；`>1` 则拒载（`ERR-STORE-003`），防止旧插件打开新库写坏数据。
- 迁移失败 → 整笔回滚，库保持原样，插件报错但不删除数据（[NFR-R-2](./05-non-functional.md#nfr-r-容错与可靠性)）。
- **不迁移上游插件的历史数据**（NG-7）；`docs/` 中说明手工导入的字段映射，若要导入需自写脚本。

## 事务边界

```
BEGIN IMMEDIATE
  SELECT current facts WHERE subject=? AND predicate=? AND status IN ('active','decayed') AND valid_until IS NULL
  -- 领域层纯函数计算 AdjudicationPlan
  UPDATE 旧事实（按策略）
  INSERT 新事实
  INSERT fact_relations（每个旧事实一条）
  INSERT adjudication_log（一条）
COMMIT
```

- 使用 `BEGIN IMMEDIATE` 立即取写锁，避免读后升级写锁导致 `SQLITE_BUSY` 竞态。
- 事务内不做网络、不做文件 IO、不调 LLM（红线见 [ADR-0004](./08-decisions/adr-0004-red-lines.md)）。
- 失败重试：`SQLITE_BUSY` 最多 3 次（间隔 50ms），仍失败则抛 `ERR-STORE-002`。

## 容量与增长

| 数据量 | 估算体积 | 召回 p95 | 备注 |
|---:|---:|---:|---|
| 1,000 条事实 | ~0.5 MB | < 5 ms | 演示规模 |
| 10,000 条事实 | ~5 MB | < 15 ms | 性能验收上限（[NFR-P-2](./05-non-functional.md#nfr-p-性能)） |
| 100,000 条 | ~50 MB | 需加索引调优 | v1 不承诺 |

- 历史版本不删除（审计需要），因此行数 ≈ 写入次数；按演示/日常使用（每日数十条）可忽略增长。
- WAL 文件在 checkpoint 后回落；插件关闭时执行 `PRAGMA wal_checkpoint(TRUNCATE)`。

## 备份与恢复

- 备份：`VACUUM INTO '<path>.bak'`（一致性快照，不阻塞读）。
- 恢复：停插件 → 覆盖 `.db`（同时删除 `-wal`/`-shm`）→ 重启。
- 损坏：`PRAGMA integrity_check`；失败则 `ERR-STORE-004`，不自动删库，交给用户处理。

## 交叉引用

- 接口如何暴露这些字段：[02](./02-api-contract.md)
- 每个约束失败时的错误码：[04](./04-errors-and-edge-cases.md)
- 不变量如何被测试：[06](./06-test-plan.md#属性测试-pt)
- 存储选型与"为什么不用外部数据库"：[ADR-0002](./08-decisions/adr-0002-tech-stack.md)
