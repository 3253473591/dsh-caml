# 05 · 非功能性需求

> 版本：v1.0 ｜ 状态：冻结候选 ｜ 指标都被 [06](./06-test-plan.md) 与 [07](./07-acceptance.md) 引用 ｜ 结构决策见 [ADR-0002](./08-decisions/adr-0002-tech-stack.md)

每条 NFR 都必须满足"有指标、有测法、有阈值、有失败后果"四件事；只有形容词的需求视为未定义。

## NFR-P 性能

**参考环境**（验收时记录在报告里）：Windows 11 / Node 24.22.1 / NVMe SSD / 单进程；数据库 10,000 条事实、WAL 已 warm。

| 编号 | 指标 | 阈值 | 测法 |
|---|---|---|---|
| NFR-P-1 | `caml-remember`（无冲突）p95 | ≤ 5 ms | LT-1 循环 1,000 次 |
| NFR-P-2 | `caml-recall`（10k 事实、无关键词）p95 | ≤ 15 ms | LT-1 |
| NFR-P-3 | `caml-recall`（带 `query` 子串）p95 | ≤ 30 ms | LT-1 |
| NFR-P-4 | `caml-audit`（单坐标 ≤ 50 版本）p95 | ≤ 20 ms | LT-1 |
| NFR-P-5 | 插件 `apply()`（含打开与迁移） | ≤ 100 ms | LT-2 |
| NFR-P-6 | 数据库体积（10k 事实） | ≤ 20 MB | LT-2 |
| NFR-P-7 | 进程常驻内存增量 | ≤ 50 MB | 进程 RSS 对比 |

**失败后果**：任一项超阈值即 AC-7 失败；调优手段限定为"加索引 / 改查询 / 减少每事务语句"，**不允许**为此引入缓存层或向量库。

## NFR-R 容错与可靠性

| 编号 | 要求 | 实现手段 | 验证 |
|---|---|---|---|
| NFR-R-1 | 裁决原子：关旧/插新/建关系/写日志全有或全无 | `BEGIN IMMEDIATE` 单事务（[INV-5](./03-data-model.md#不变量)） | FT-1 |
| NFR-R-2 | 迁移失败不损坏数据 | 迁移在事务内；失败回滚并保留原库 | IT-2 |
| NFR-R-3 | 写锁竞争可自愈 | `busy_timeout=2000` + 3 次重试（50ms 间隔） | FT-3 |
| NFR-R-4 | 错误不静默 | 所有失败路径抛带 `code` 的错误；无 `catch {}` 空吞 | 代码审查 + TC-8 |
| NFR-R-5 | 插件隔离 | `apply()` 内 try/catch 到 fiber 边界；加载失败不阻塞宿主 | IT-2 |
| NFR-R-6 | 只读降级 | 写失败不影响 `caml-recall`/`caml-audit`（WAL 下读不阻塞） | FT-3 |
| NFR-R-7 | 卸载安全 | disposer 等待在途事务（≤2s）后关库 | FT-5 |
| NFR-R-8 | 不删数据 | 任何错误路径都不 `DELETE`；唯一删除路径是用户手工操作 | 代码审查 |

## NFR-C 兼容性

| 编号 | 要求 | 证据 |
|---|---|---|
| NFR-C-1 | DSH `0.2.1-rc.2` 可加载并注册三工具 | `engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"`；IT-2 |
| NFR-C-2 | Node `^22.19.0 \|\| >=24.0.0`（与 DSH 一致）；`node:sqlite` 免 flag | LT-2 在 22 与 24 各跑一次 |
| NFR-C-3 | Windows / macOS / Linux 行为一致（路径、权限、换行） | CI 矩阵；IT-2 |
| NFR-C-4 | 无原生模块、无运行时依赖 | `package.json` 的 `dependencies` 为空；CI 断言 |
| NFR-C-5 | SQLite ≥ 3.37（`STRICT`） | 启动时 `SELECT sqlite_version()` 断言，低版本给 `ERR-STORE-004` 式提示 |

**兼容门说明**：DSH 0.2.1-rc.2 的判定逻辑是"有 `engines.dsh` 只看它，否则看 `@deepseek-ai/dsh*` peers，且 `includePrerelease: true`"。本插件声明 `engines.dsh`，因此**不依赖** peer 推断；声明范围已覆盖 rc 预发布版本。

## NFR-S 安全与隐私

| 编号 | 要求 | 实现 |
|---|---|---|
| NFR-S-1 | 纯本地：无出站网络 | 不 import `http`/`https`/`fetch`；IT-6 断言 |
| NFR-S-2 | 文件权限收敛 | 目录 `0700`、库文件 `0600`（Windows 上尽力而为，记录差异） | 
| NFR-S-3 | 不宣称"密钥扫描" | 明确写入 README：正文原样存储；不要写入密钥；日志不落正文 |
| NFR-S-4 | 记忆内容是**数据不是指令** | `render` 用边界标注包裹；不把事实正文拼进系统提示；注入文本只作为普通字符串 |
| NFR-S-5 | 日志最小化 | `adjudication_log` 只存 id/策略/原因；错误日志不打印 object 正文 |

> 为什么不做脱敏：脱敏会制造"以为安全"的错觉，且误杀技术文本（参见生态里同类插件的教训）。v1 选择"明确声明 + 可审计"，把责任边界写清楚。

## NFR-O 可观测性

| 编号 | 要求 | 形式 |
|---|---|---|
| NFR-O-1 | 每次裁决可追溯 | `adjudication_log` 一行；`caml-audit` 可读 |
| NFR-O-2 | 错误可定位 | stderr 一行 JSON：`{ts, code, tool, details}`；不含正文 |
| NFR-O-3 | 状态可自检 | 启动时 `PRAGMA integrity_check`（开销 ≤ 50ms 时执行，否则延后到首次写） |

## NFR-M 可维护性

| 编号 | 要求 | 形式 |
|---|---|---|
| NFR-M-1 | 零运行时依赖 | `dependencies` 为空；devDependencies 仅测试工具（可为零） |
| NFR-M-2 | 模块边界单向 | `domain`（纯函数）← `store` ← `tools` ← `plugin`；反向 import 由 lint 规则禁止 |
| NFR-M-3 | 领域层可单测 | 不触碰 fs/DB 的纯函数，覆盖策略全部分支 |
| NFR-M-4 | 文档可追踪 | [追踪矩阵](./README.md#需求追踪矩阵) 每行非空 |

**覆盖率目标**（非硬性验收项，但写入 README）：`domain/` ≥ 90% 行覆盖，`store/` ≥ 80%，`tools/` ≥ 70%。

## 指标汇总（验收时逐项填数）

| 指标 | 阈值 | 实测 | 结论 |
|---|---:|---:|---|
| NFR-P-1 caml-remember p95 | ≤ 5 ms | | |
| NFR-P-2 recall p95 | ≤ 15 ms | | |
| NFR-P-4 audit p95 | ≤ 20 ms | | |
| NFR-P-5 apply | ≤ 100 ms | | |
| NFR-P-6 体积 | ≤ 20 MB | | |
| NFR-C-4 运行时依赖 | 0 | | |

## 交叉引用

- 测法与用例编号：[06](./06-test-plan.md)
- 判定入口与证据要求：[07](./07-acceptance.md)
- 为什么这些约束不可协商：[ADR-0004 红线](./08-decisions/adr-0004-red-lines.md)
