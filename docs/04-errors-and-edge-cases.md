# 04 · 边界与异常

> 版本：v1.0 ｜ 状态：冻结候选 ｜ 错误码被 [02](./02-api-contract.md)、[05](./05-non-functional.md)、[06](./06-test-plan.md)、[07](./07-acceptance.md) 引用

本文件是"系统在坏路径上如何表现"的唯一事实来源。原则三条（源自 [ADR-0004](./08-decisions/adr-0004-red-lines.md)）：

1. **失败要响**：不静默降级、不吞异常、不用默认值掩盖非法输入。
2. **失败要可恢复**：任何错误都不得删除或改写已有事实；事务失败整笔回滚。
3. **失败不拖垮宿主**：DSH 插件加载失败只让本 fiber 失败，宿主照常启动。

## 错误对象

```ts
interface CamlError extends Error {
  code: string            // 见下表，稳定，可作为测试断言
  message: string         // 面向用户的一句话，中文
  details?: unknown       // 结构化上下文（字段名、越界值、SQLite 原始码）
  retryable: boolean      // 调用方是否可原样重试
  hint?: string           // 一句话修复建议
}
```

工具层把 `CamlError` 原样抛出；DSH 渲染 `message`。`code` 与 `retryable` 进入日志。

## 错误码

### 输入类

| 码 | 触发条件 | 消息示例 | retryable | 处理 |
|---|---|---|---|---|
| `ERR-INPUT-001` | 必填字段缺失 | `缺少必填字段 subject` | 否 | 补字段 |
| `ERR-INPUT-002` | 类型不符 | `limit 必须是整数` | 否 | 改类型 |
| `ERR-INPUT-003` | 时间格式非法 | `observedAt 必须是带时区的 ISO-8601` | 否 | 补 `Z`/偏移 |
| `ERR-INPUT-004` | `observedAt` 超过未来偏差 | `observedAt 晚于当前时间 5 分钟以上，拒绝写入` | 否 | 用真实时间或调 `futureSkewMs` |
| `ERR-INPUT-005` | 超长 | `object 超过 2000 字符（当前 2314）` | 否 | 截断或改配置 |
| `ERR-INPUT-006` | 未知字段 | `未知字段：obiekt` | 否 | 删除或改正 |
| `ERR-INPUT-007` | predicate 非法 | `predicate 只能由字母/数字/_/./- 组成，且以字母开头` | 否 | 按规则命名 |
| `ERR-INPUT-008` | 归一化后为空 | `subject 归一化后为空` | 否 | 提供非空白值 |
| `ERR-INPUT-009` | 数值越界 | `limit 必须在 1–100` | 否 | 调整取值 |
| `ERR-INPUT-010` | `query` 非法 | `query 长度为 1–200 字符` | 否 | 调整 |
| `ERR-INPUT-011` | `asOf` 非法 | `asOf 必须是合法 ISO-8601` | 否 | 修正时间 |

### 状态类

| 码 | 触发条件 | 消息示例 | retryable | 处理 |
|---|---|---|---|---|
| `ERR-STATE-001` | 违反 [INV-1](./03-data-model.md#不变量)（同坐标多条 active）。**正常写入不可达**，只能由删索引后的外部改写产生 | `记忆库状态异常：同一坐标存在 2 条 active 事实` | 否 | 见[排障](#排障) |
| `ERR-STATE-002` | `observedAt` 早于当前有效事实的 `valid_from` | `不允许补写历史：新事实时间早于当前事实` | 否 | 用更晚时间，或先 `caml-audit` 再决定 |
| `ERR-STATE-003` | 不可达的状态迁移（防御性） | `非法状态迁移：superseded → active` | 否 | 报告 bug |

### 存储类

| 码 | 触发条件 | 消息示例 | retryable | 处理 |
|---|---|---|---|---|
| `ERR-STORE-001` | 目录不可写 / 无法打开 | `无法打开记忆库：D:\...\.dsh-caml（权限不足）` | 否 | 修权限/换 `dbPath` |
| `ERR-STORE-002` | 写锁竞争超时（`SQLITE_BUSY`） | `记忆库正被占用，请稍后重试` | 是 | 3 次 50ms 后退回 |
| `ERR-STORE-003` | `user_version` 高于本插件 | `记忆库版本 2 高于插件支持版本 1` | 否 | 升级插件，勿降级写入 |
| `ERR-STORE-004` | 完整性检查失败 | `记忆库损坏：integrity_check 未通过` | 否 | 从备份恢复，见[排障](#排障) |
| `ERR-STORE-005` | 磁盘满（`SQLITE_FULL`） | `磁盘空间不足，写入已回滚` | 是 | 清理磁盘后重试 |
| `ERR-STORE-006` | 事务被中断（进程被杀/取消） | `写入被中断，已回滚` | 是 | 重试即可 |

### 配置类

| 码 | 触发条件 | 消息示例 | retryable | 处理 |
|---|---|---|---|---|
| `ERR-CONF-001` | 配置 schema 校验失败 | `strategies.decayFactor 必须在 0.05–0.95` | 否 | 改配置 |
| `ERR-CONF-002` | `dbPath` 为空或指向目录 | `storage.dbPath 必须是非空文件路径` | 否 | 改配置 |
| `ERR-CONF-003` | 策略枚举非法 | `未知策略：supersede_soft` | 否 | 三选一 |

### 内部类

| 码 | 触发条件 | 消息示例 | retryable | 处理 |
|---|---|---|---|---|
| `ERR-INT-001` | 兜底未预期异常 | `内部错误：...` | 否 | 附 `details.stack` 报 bug |
| `ERR-INT-002` | `metadata` 不可 JSON 序列化 | `metadata 含无法序列化的值` | 否 | 改为纯 JSON 值 |

## 事实写入边界

| # | 边界 | 确定行为 | 覆盖用例 |
|---|---|---|---|
| B1 | `subject` 为 `""` 或纯空白 | 归一化后为空 → `ERR-INPUT-008` | TC-6 |
| B2 | emoji / 组合字符（如 `👨‍👩‍👧`、`é` 的两种编码） | NFKC 归一；长度按 Unicode code point 计（`Array.from(s).length`）；`👨‍👩‍👧` 计 5 | TC-6 |
| B3 | `object` 含全角/半角混写（`ＡＢＣ` vs `ABC`） | NFKC 折叠后视为同一值 | TC-6 |
| B4 | `object` 仅大小写不同（`Shanghai` vs `shanghai`） | casefold 后相等 → `duplicate` | TC-1 |
| B5 | `object` 首尾/内部多空白 | 折叠后比较与存储 | TC-6 |
| B6 | `predicate` 含中文（`目标城市`） | 合法（允许 Unicode 字母）；不转小写，按原样做策略键 | TC-6 |
| B7 | `predicate` 含空格或 `/` | `ERR-INPUT-007` | TC-6 |
| B8 | `metadata` 含 `undefined`/函数 | `ERR-INT-002` | TC-6 |
| B9 | `metadata` 序列化超 4KB | `ERR-INPUT-005` | TC-6 |
| B10 | `observedAt` 恰等于当前事实 `valid_from` | 属"补写同一时刻"，返回 `ERR-STATE-002`（应用层预检，不靠 CHECK 报错） | TC-6 |
| B11 | `observedAt` 早于当前 `valid_from` | `ERR-STATE-002` | TC-6 |
| B12 | `observedAt` 晚于 `now + futureSkewMs` | `ERR-INPUT-004` | TC-6 |
| B13 | 同一请求并发两次（同进程或两进程） | 先提交者成功；后者读不到未提交数据，重试后走 `duplicate` | IT-5, FT-3 |
| B14 | 同一坐标存在多条 active（外部改写） | `ERR-STATE-001`，不擅自修复 | FT-4 |
| B15 | `object` 与旧值**语义**相同但字面不同（"北京" vs "北京市"） | 视为冲突并按策略裁决（**明确不承诺语义等价**，见 NG-1） | ET-9（反例） |
| B16 | 新值与**历史**值相同、但与当前值不同（A→B→A） | 正常裁决：新建版本、处理当前事实；历史行不复活，也不是 `duplicate` | ET-A-06 |

## 召回边界

| # | 边界 | 确定行为 | 用例 |
|---|---|---|---|
| C1 | `limit=0` 或 `101` | `ERR-INPUT-009`（不静默 clamp） | TC-3 |
| C2 | `query` 含 `%` 或 `_` | 转义为字面量，不做通配 | TC-3 |
| C3 | `query` 命中大小写不同的值 | 大小写不敏感匹配 | TC-3 |
| C4 | `asOf` 恰好等于某事实的 `valid_until` | 该事实**不**被返回（左闭右开） | TC-4 |
| C5 | `asOf` 为未来时间 | 按 `now` 处理并在响应回显 | TC-4 |
| C6 | `asOf` 早于所有事实 | 返回空数组，不是错误 | TC-4 |
| C7 | 传 `includeSuperseded` | 未知字段 → `ERR-INPUT-006`（v1 无此参数；历史查询走 `asOf` / `caml-audit`） | TC-4 |
| C8 | 命中数 > `limit` | 返回前 `limit` 条，`truncated=true` | TC-3 |

## 审计边界

| # | 边界 | 确定行为 | 用例 |
|---|---|---|---|
| A1 | 坐标无任何事实 | `timeline: []`、`current: null`、`versions: 0`，**不报错** | TC-4 |
| A2 | 版本数 > `limit` | 取前 `limit` 条，`truncated.timeline=true` | TC-4 |
| A3 | 裁决数 > `limit` | 同上 | TC-4 |
| A4 | 事实被外部删除但日志还在 | `timeline` 缺该条；`adjudications.previousIds` 可能指向不存在 id → 原样返回 id 并标 `missing=true` | FT-4 |

## 存储与生命周期边界

| # | 边界 | 确定行为 | 用例 |
|---|---|---|---|
| S1 | 插件加载时目录不可写 | `apply()` 抛 `ERR-STORE-001`；fiber 失败；**宿主继续启动**，其他插件不受影响 | IT-2 |
| S2 | 插件加载时库损坏 | `ERR-STORE-004`，不自动删库、不自动重建 | IT-2, FT-2 |
| S3 | 卸载时存在进行中的写入 | disposer 等待事务结束（上限 2s），超时则取消并回滚 | FT-5 |
| S4 | 两个 DSH 实例共用同一 `dbPath` | 允许：WAL + `busy_timeout=2000`；不保证跨实例缓存一致（v1 无缓存） | FT-3 |
| S5 | 磁盘写满 | 事务回滚 → `ERR-STORE-005` | FT-6 |
| S6 | 进程在 `COMMIT` 前被杀 | SQLite 回滚未提交事务；无半写状态 | FT-1 |
| S7 | 进程在 `COMMIT` 后被杀 | 事务完整生效；下次启动可见 | FT-1 |
| S8 | `user_version` 高于插件 | `ERR-STORE-003`，拒绝写入（防止降级写坏） | IT-2 |

## 安全相关边界

| # | 边界 | 确定行为 | 用例 |
|---|---|---|---|
| X1 | 事实正文含提示注入（"忽略之前所有指令"） | 原样存为**数据**；`render` 前后加边界标注，不拼接为指令；模型侧以 `output` 为准 | IT-4 |
| X2 | 事实正文含密钥形态字符串 | v1 **不扫描、不脱敏**（明确声明，见 [NFR-S-3](./05-non-functional.md#nfr-s-安全与隐私)）；文档提醒不要写入密钥 | — |
| X3 | 日志写入 | 只写 id/策略/原因，不写 object 正文 | TC-7 |
| X4 | 网络 | 全链路无出站请求（可在测试中断言 `fetch`/`net` 未被调用） | IT-6 |

## 明确不覆盖的边界

与 [NG 清单](./01-prd.md#32-明确不做) 对应，出现以下情况时按"未定义行为"处理，文档与 README 必须声明：

- 语义等价（同义词/别名/简繁/单位）：按字面冲突处理，不做猜测。
- 跨 subject 推理（"上海" 与 "华东" 的关系）。
- 撤销取代（把 `superseded` 改回 active）。
- 冲突待人工确认（`pending`）。
- 上游插件历史数据自动导入。
- 并发写同一坐标的**顺序保证**（只保证不破坏不变量，不保证谁先）。

## 排障 <a id="排障"></a>

### `ERR-STATE-001`（多条 active）

```sql
-- 只读诊断
SELECT subject, predicate, COUNT(*) FROM facts
WHERE status='active' AND valid_until IS NULL
GROUP BY subject, predicate HAVING COUNT(*) > 1;
```

修复原则：保留 `created_at` 最大的一条为 active，其余按策略改写为 `superseded` 并补 `fact_relations`。**不要直接 DELETE**，否则审计断链。修复完成后**必须重建** `ux_facts_one_active`（该状态只可能由它被删除或外部改写产生）。修复脚本作为 M5 交付物之一。

### `ERR-STORE-004`（损坏）

1. `PRAGMA integrity_check;` 确认。
2. 停插件，复制 `.db` 留证。
3. 从最近 `VACUUM INTO` 备份恢复（[03 备份与恢复](./03-data-model.md#备份与恢复)）。
4. 无备份时：新建库，把可读部分经 `caml-audit` 导出为 JSON 再重放。

### `ERR-STORE-002`（占用）

确认是否有第二个 DSH 实例或外部工具打开同一 `.db`；`busy_timeout` 已设 2s，持续失败说明存在长事务。

## 交叉引用

- 这些码在哪些用例里被断言：[06](./06-test-plan.md)
- 哪些码会阻断验收：[07](./07-acceptance.md)
- 错误处理的非功能指标：[05](./05-non-functional.md#nfr-r-容错与可靠性)
