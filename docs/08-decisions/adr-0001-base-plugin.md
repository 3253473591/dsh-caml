# ADR-0001 · 改造哪个 DSH 记忆插件

> 状态：已接受 ｜ 日期：2026-11-08 ｜ 决策者：项目作者 ｜ 影响：[01 PRD](./../01-prd.md#1-背景与问题)、[ADR-0003](./adr-0003-project-structure.md)

## 背景

需要一个 DSH 插件外壳来承载 CAML 的裁决语义。硬约束：**MIT 协议**、可在 **DSH 0.2.1-rc.2** 加载、改造量可控（两周内）。调研结论：生态里没有插件已经实现"显式冲突裁决"，所以底座提供的是**外壳**（cordis 生命周期、工具注册、本地存储、注入），不是语义。

## 选项

| 候选 | ★ | 存储 | 现状 | 判定 |
|---|---:|---|---|---|
| [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) | 930 | 编排层 + 9 个 provider | 已支持 0.2.1-rc.x（`engines.dsh` 覆盖） | ❌ 改它等于改一个框架；依赖树与职责远超需求 |
| [dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) | 377 | `node:sqlite` 七层（含 fact） | 声明兼容 0.1.5，运行时探测能力 | ⚠️ 最接近（SQLite + 无向量库），但 fact 层是自由文本，且 dream/reflect 有多条 LLM 写入路径，接漏即"绕过裁决" |
| [dsh-memory](https://github.com/RestRegular/dsh-memory) | 12 | JSONL + 本地向量 | 0.30.1，维护活跃 | ❌ 向量栈与 [NG-1](./../01-prd.md#32-明确不做) 直接冲突；已有手工 `supersedes`，改造叙事变弱 |
| [dsh-memory-plugin](https://github.com/AieXile/dsh-memory-plugin) | 0 | 单个 JSON 文件 | 1.6.0；已实测 0.1.7-rc.2 | ✅ **选中** |
| [dsh-peoplememory](https://github.com/whitequeen306/dsh-peoplememory) | 0 | 骨架 | 0.1.0、`private`、约 20KB | ❌ 等于从零写，"改造"无从谈起 |
| [dsh-git-memory](https://github.com/seriousz158/dsh-memory) | 169 | Git + Markdown | 0.2.0-rc.2 桌面端 | ❌ Git/LaunchAgent/macOS 绑定；已自称有冲突处理，叙事撞车 |

## 决定

**fork `AieXile/dsh-memory-plugin@1.6.0`**（MIT），保留其插件外壳与工具面形态，重写存储层与裁决层。

理由（按权重）：

1. **语义最接近**：它已有 `status: active | archived`、`supersedes` / `supersededBy`、`memory_rollback`。CAML 的 `superseded_by`、权重、时间窗是在这套骨架上做加法，而不是另起一套。
2. **写入路径收敛**：只有 `memory_add` / 草稿批准 / 面板 action 三条，且都进同一个 store。裁决器接一处即覆盖全部（meow 的多路径写入是最大隐患）。
3. **改造面可审计**：`lib/host.js` 单文件、零依赖、无构建。存储 JSON → SQLite 是"换一个模块"，diff 小且每行可讲。
4. **合规成本低**：MIT，保留 LICENSE + NOTICE 即可；包名与上游不同，避免 npm 冲突。

## 后果

**好的**：两周内可完成；diff 可逐行讲解；工具契约可直接复用 DSH 注册形态。

**坏的（必须写进 README）**：

- 上游只在 DSH `0.1.7-rc.2` 实测过，0.2.1-rc.2 的移植风险由我们承担。缓解：M1 第一天做 spike（[01 §10](./../01-prd.md#10-风险与缓解)）。
- 上游 0 星，不能拿"站在成熟项目上"当卖点；卖点必须是"裁决契约 + 评测"。
- 上游数据模型是自由文本，**不迁移**其历史数据（[NG-7](./../01-prd.md#32-明确不做)）；已有用户需要手工导出。
- 上游的 UI 半边（标题栏/设置页）在 v1 不保留，只留 Host 半边；这是删功能，必须在 README 说明。

## 何时重审

- M1 的 spike 在 0.2.1-rc.2 上失败且 4 小时内无法修复 → 改用 `dsh-meow-memory`（需接受多写入路径的整合成本）。
- 上游发布 breaking 变更或归档 → 重新评估是否转为自维护。

## 备选方案（若底座失效） <a id="备选方案"></a>

`dsh-meow-memory`：它已有 `node:sqlite` 与 fact 层，能省掉存储实现，但需要把 `memory_remember`、dream 蒸馏、reflect 三条写入路径全部接到裁决器上，并处理它自己的 `status` 语义。**作为 PLAN B，不作为默认。**
