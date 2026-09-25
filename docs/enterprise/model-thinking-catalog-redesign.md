<!--
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# 模型思考档位（Effort）重新设计

2026-09-24。缘起：composer 模型选择器里的 effort 时有时无。查下来不是 UI 状态问题，是"一个模型支持哪些思考档位"
这个事实的取源方式有结构性缺陷。本文把这条链路整体重新设计。每条现状结论标了来源：**读代码** / **实测** / **推断**。

## 1. 现状与问题

### 1.1 现在的链路（读代码）

```
provider discovery ──► connection-catalog.json 的 models 行（无 effort 信息）
                                │
Host  resolveConnectionModelCatalog ──► thinkingVariantsForConnection
                                │           = modelOverrides[id].thinkingLevels
                                │             ?? deriveThinkingChoices(lookupModelMetadata(active)[id].thinkingOptions)
                                ▼
                    catalogEntries[].thinkingLevels ──► desktop main buildChatModelChoices
                                                              │
                                                        ModelMenu：levels.length > 0 才渲染 effort
```

`active` 元数据表 = Host 启动时向 models.dev 拉一次（10 秒超时、直连、只试一次）成功后的表，否则是构建时打包的快照
（`model-metadata.generated.ts`，快照生成于 2026-09-02）。

运行时另有一条独立推导：`model-factory.ts` 的 `defaultOpenAiReasoningEffort` 与 `openAiResponsesSummary` 再次从
`thinkingOptionsForModel` 读元数据，决定省略档位时发什么 `reasoningEffort`、要不要请求 reasoning summary。

### 1.2 实测的故障（实测）

| 模型 | 打包快照 | 线上 models.dev |
|---|---|---|
| `gpt-6-astra` / `gpt-6-sol` / `gpt-6-luna`（Codex 订阅） | 缺失 | low…max |
| `anthropic/claude-opus-5.5`（OpenRouter） | 缺失 | low…max |
| `anthropic/claude-sonnet-5`（OpenRouter） | 有 | 有 |

启动时刷新成功 → 前四个有 effort；超时或失败 → 整个运行期间没有，直到下次重启。直连拉一次 api.json 本机耗时 4.5 秒，
10 秒超时很容易被网络抖动打穿。刷新失败只 `console.error` 到 Host 的 stderr，而 launcher 只把 stderr 留在内存里等进程
退出时用，用户永远看不到。

### 1.2b 追加：线上刷新自 2026-09-18 起每次必败（实测）

Phase 0 跑 `npm run refresh:model-metadata` 时发现：models.dev 在 09-18 把 provider `kimi-for-coding` 拆成
`kimi-code-plan-cn`（`api.kimi.com`，即 Maka 连的站点）和 `kimi-code-plan-global`（`api.kimi.ai`），而 `models-dev-projection.ts` 的映射表仍指向旧名，`selectModelsDevCatalog` 对缺失的 provider
直接抛错，整份目录作废。Host 启动时的刷新走的是同一个函数，所以 09-18 之后每次启动都回退到打包快照，effort
对 gpt-6 系列一次也不会再出现；09-18 之前刷新成功与否取决于 10 秒内能不能拉完，这就是"时有时无"的完整解释。

同一轮还发现上游 schema 新增了不带 `npm` 的 `provider.body` 覆盖，生成脚本同样直接中止。两处都已在 Phase 0 修掉，
但根因是设计层面的：**一个 provider 的改名不该让其余四十几个 provider 的事实一起作废**。Phase 2 的刷新要改成
"缺失的 provider 记一条、沿用上一版该 provider 的投影、其余照常接受"，生成脚本保持 fail-loud 让人来处理映射。

### 1.3 问题清单

- **P1 拿第三方目录去判定 provider 自己已经声明的事实。** Codex 的 `/backend-api/codex/models` 每个模型都带
  `supported_reasoning_levels`（`[{effort, description}]`）和 `default_reasoning_level`（仓库里的
  `packages/eval/harbor/deepseek-codex-models.json` 就是一份实录），fetcher 只保留 slug / priority / context_window，
  把这两个字段丢了（`model-fetcher.ts` 的 `RawOpenAiCodexModel`）。GitHub Copilot 的 `supports.reasoning_effort[]`
  只用来算了个布尔 `reasoning`。
- **P2 刷新一次定终身，失败静默，不落盘。** 一次网络抖动决定整个运行期间的 UI 能力，且没有任何可见痕迹。
- **P3 打包快照陈旧。** 新模型上线到快照更新之间的窗口期，全靠 P2 那次刷新。
- **P4 目录和运行时各推一遍，且都依赖元数据。** 元数据缺失的模型不但 effort 不显示，`reasoningEffort` 也不发、
  reasoning summary 也不请求，用户会同时发现"思考摘要没了"。两处推导也可能不一致。
- **P5 UI 把"不知道"当"不支持"。** `levels.length === 0` 一律隐藏，用户无从得知是模型不支持还是 Maka 不认识。
- **P6 provider discovery 没有新鲜度概念。** 只在用户手动刷新/测试/登录时跑（`connection-effect-coordinator.ts`），
  `modelsFetchedAt` 存了但没人读。

## 2. 参照

- **Codex CLI**：模型列表和每个模型的 effort 档位、默认档位都来自后端 `/models`，缓存到 `CODEX_HOME/models_cache.json`
  带 TTL，另有一份硬编码兜底。effort 选择器直接渲染 `supported_reasoning_levels`，第三方目录不参与。
- **OpenCode**（models.dev 的作者）：构建时打包快照；运行时先读 `~/.cache/opencode/models.json`，后台刷新成功再覆盖
  这个文件。任何一次失败都不会让用户退回旧快照。

两者的共同点：**谁最了解模型就听谁的；拿到过的事实落盘；跨启动确定。**

## 3. 设计原则

1. **来源分层。** 用户声明 › provider 自述 › 目录（models.dev 缓存 / 打包快照）› 无。每一层只在上一层没说话时发言。
2. **一次解析，处处复用。** Host 解析一次，结果随 `catalogEntries` 下发；渲染层、运行时都用这份结果，不再各自从元数据
   推。
3. **跨启动确定。** 拿到过的 models.dev 表和 provider 自述都落盘；UI 能力只在新事实落盘后改变，不随一次网络结果摇摆。
4. **未知 ≠ 不支持。** 不知道时告诉用户不知道，并给出去声明的入口。
5. **失败可见。** 刷新结果有日志、有界面状态、有手动重试。
6. **线上只发声明过的档位。** 无论哪一层给的 levels，都是 wire 允许发的档位；运行时不再有第二套判断。

## 4. 数据模型

### 4.1 provider 自述：`ModelInfo.thinking`

```ts
/** provider 在 discovery 响应里对一个模型的思考档位自述。 */
export interface ModelThinkingDeclaration {
  readonly levels: readonly ThinkingLevel[];      // 显示序，去重，未知值丢弃
  readonly defaultLevel?: ThinkingLevel;          // provider 说的默认档位
}
// ModelInfo 新增
thinking?: ModelThinkingDeclaration;
```

各 fetcher 的映射：

| provider | 字段 | 映射 |
|---|---|---|
| `openai-codex` | `supported_reasoning_levels[].effort`、`default_reasoning_level` | `none`→`off`，其余同名；非 `ThinkingLevel` 词汇丢弃 |
| `github-copilot` | `supports.reasoning_effort[]` | 同上 |
| `openrouter` | `supported_parameters` 含 `reasoning` | `levels = ['low','medium','high']`（OpenRouter 文档的通用 effort 集合，Anthropic 系的 budget 换算由 OpenRouter 自己做） |
| 其余 openai-compatible / anthropic / google | 无自述 | `thinking` 缺省，落到下一层 |

### 4.2 Host 解析结果：`ModelCatalogEntry.thinking`

替换现在的 `thinkingLevels: ThinkingLevel[]`：

```ts
export type ThinkingFactsSource = 'user' | 'provider' | 'catalog' | 'none';

export interface ModelThinkingFacts {
  readonly levels: readonly ThinkingLevel[];
  readonly defaultLevel?: ThinkingLevel;
  readonly source: ThinkingFactsSource;
  /** 模型会不会推理：yes 有任一来源声明；no 有来源明确否认；unknown 谁都没说。 */
  readonly reasoning: 'yes' | 'no' | 'unknown';
}
```

`reasoning` 的判定：`levels` 非空，或 provider / 元数据 `capabilities.reasoning === true` → `yes`；
`capabilities.reasoning === false` 且 `levels` 为空 → `no`；否则 `unknown`。

### 4.3 唯一的解析器（core）

```ts
export function resolveModelThinking(input: {
  providerType: ProviderType;
  model: ModelInfo;                       // 含 provider 自述
  override: ModelOverride | undefined;    // 用户声明
  metadata: ModelMetadata;                // lookupModelMetadata(active)
}): ModelThinkingFacts;
```

- `levels`：`override.thinkingLevels` → `model.thinking.levels` → `deriveThinkingChoices(metadata.thinkingOptions)` → `[]`。
- `defaultLevel`：`model.thinking.defaultLevel`（用户层没有默认的概念）→ 目录层规则（现在散在 `model-factory.ts` 里的
  "OpenAI 家族默认 medium" 迁到这里）→ 无。
- `source` 记录 `levels` 最终来自哪一层。

现有的 `thinkingVariantsForConnection` / `resolveThinkingLevel` / `thinkingOptionsForModel` 全部收敛到这一个函数，
调用方只剩四个文件：`model-catalog.ts`、`session-catalog-coordinator.ts`（校验）、`model-factory.ts`（下线）、
`model-thinking.ts` 自身。

### 4.4 运行时改用解析结果

`execution-model-authority` 把 Host 解析出的 `ModelThinkingFacts` 随执行模型一起交给 runtime（`RuntimeExecutionModel.thinking`），
`model-factory.ts` 只做"档位 → wire"映射：

- 用户选了档位：发该档位（校验已在 Host 做过）。
- 用户没选（"模型默认"）：`facts.defaultLevel` 存在则显式发它，否则省略让服务端决定。Codex 后端和 Codex CLI 都是这样：
  CLI 把 `default_reasoning_level` 显式发出去。
- reasoning summary 的请求条件改为 `facts.reasoning === 'yes'`，不再看元数据。

这样 P4 的两处推导合并成一处，元数据缺失的模型只要 provider 自述了，档位、默认值、摘要三件事一起对。

### 4.5 存储

- `connection-catalog.json` 的模型行 codec（`connection-catalog-codec.ts`）allowlist 加 `thinking` 键，做同样的
  精确校验（去重、词汇表、`defaultLevel ∈ levels`）。`SCHEMA_VERSION` 升到 3。旧文档的行没有这个字段，读入即
  `undefined`，不写迁移、不做别名；第一次重新 discovery 后自然补上（见 5.2）。
- 新增 `model-metadata-cache.json`（与 `connection-catalog.json` 同目录，走 `document-io.ts` 的
  `readBoundedJsonDocument` / `writeJsonDocument`）：

```ts
interface ModelMetadataCacheDocument {
  readonly schemaVersion: 1;
  readonly fetchedAt: number;        // unix ms
  readonly digest: string;           // 投影 JSON 的 sha256，比对是否真的变了
  readonly metadata: ModelsDevMetadataProjection;
}
```

上限沿用 `MODELS_DEV_RESPONSE_MAX_BYTES`。

## 5. 刷新与新鲜度

### 5.1 models.dev 层

Host 启动顺序改为：

1. 读 `model-metadata-cache.json`，有则 `installRefreshedModelMetadata(cache.metadata)`。**同步，在第一次目录投影之前**
   （`execution-composition.ts` 里 `runtimePolicyStores` 就绪后、`HostChangeFeed` 之前）。
2. 后台刷新：超时 30 秒；失败按 5 秒 / 30 秒 / 5 分钟退避重试三次；之后每 24 小时一次。
3. 成功：算 digest，与当前不同才 install + 写缓存 + `publishConnectionCatalog()`；相同只更新 `fetchedAt`。
4. 失败：记 `lastRefresh = {at, outcome:'failed', error}`，现状不变。隐私模式：不联网，但缓存照用。
5. 打包快照仍是最底层兜底；removals 语义不变。
6. **部分接受**：上游缺失某个映射的 provider 时，Host 记一行日志、该 provider 沿用当前表里的投影、其余 provider 照常
   更新；只有响应整体不可解析才算失败。生成脚本不变，仍 fail-loud。

### 5.2 provider discovery 层

Host 启动后（以及此后每 24 小时）对满足 `modelSource === 'fetched'` 且 `now - modelsFetchedAt > 24h` 的连接，
串行后台重跑 discovery，复用现有 `beginModelFetch` / `completeModelFetch` 事务，凭据不可用（needs_reauth）直接跳过。
失败保留旧行，把错误记到该连接的 `lastDiscovery`（新字段，与 `lastTest` 同形）。成功且模型行有变化才 publish。

这一条同时解决 P6，并让 4.5 的 schema 升级不需要迁移：第一次启动就会把 `thinking` 补进 Codex 连接的行里。

### 5.3 状态暴露

Host 新增只读查询 `catalog.metadata.status` 和操作 `catalog.metadata.refresh`：

```ts
interface ModelMetadataStatus {
  readonly bundledSnapshotDate: string;                 // 生成快照的日期
  readonly cache: { fetchedAt: number } | null;
  readonly active: 'bundled' | 'cache' | 'refreshed';
  readonly lastRefresh: { at: number; outcome: 'ok' | 'failed' | 'skipped'; error?: string } | null;
  readonly nextRefreshAt: number | null;
}
```

## 6. UI

### 6.1 composer 模型菜单（`ModelMenu.tsx`）

| `facts` | chip | 菜单 |
|---|---|---|
| `levels` 非空 | 只显示生效的档位：选中的档位，或 provider 声明的默认档位（如"高"）；都没有时不显示档位 | 未选档位的那一行叫"模型默认"，有 `defaultLevel` 时副标"当前为：高"，没有时副标"由服务端决定"；子菜单入口的值写"模型默认 · 高" |
| `levels` 空，`reasoning === 'no'` | 不显示 effort | 不显示 effort 行 |
| `levels` 空，`reasoning ∈ {yes, unknown}` | 不显示 effort | 显示 effort 行，值"未声明"，子菜单一句说明 + "去设置里声明"入口（跳到 设置 › 模型连接 › 该模型的声明面板，relay 已有 `declareCapabilities` 面板可复用） |

**"自动"改名为"模型默认"。** 现在的"自动"对 Anthropic 是自适应、对 OpenAI 是 Maka 写死的 medium、对元数据缺失的模型是
什么都不发，三种含义共用一个词，而且"自动"暗示有人在按难度调节，只有 Anthropic 真是这样。改名后的定义只有一个：
**Maka 不指定档位，用模型或服务端自己的默认**。三语文案：简中"模型默认"、繁中"模型預設"、英文"Model default"。
`composer-copy.ts` 的 `effortDefault` / `effortAutoHelp` 两个键随之改文案，`effortAutoHelp` 改为
"不指定档位，按模型自己的默认深度思考。"；`model-factory.ts` 里 OpenAI 写死 medium 的那段随 4.4 一起删除。

切会话时 connections store 清空重载导致的几百毫秒闪烁保留不动，那是 resource-store 的通用行为，不在本设计范围。

### 6.2 设置 › 模型连接

- 页头加一条目录状态：`模型目录：models.dev 更新于 09-24 22:41（缓存） · 刷新`，失败时显示原因。数据来自 5.3。
- 每个连接的模型区块：`模型列表更新于 …`（读 `modelsFetchedAt`）+ 现有的刷新按钮；`lastDiscovery` 失败时在同一行显示。
- 模型行的"思考"标签后缀来源：`思考 · 来自 provider` / `· 自定义` / `· 目录`，用户一眼知道这个档位集是谁说的。
- 声明面板：模型有 provider 自述时，勾选框按自述预填并标注"provider 声明"，用户改动后变成"自定义"。

### 6.3 会话

刷新后 `session.thinkingLevel` 不在新 `levels` 里时，发送时按现有 discard 语义降为"模型默认"，chip 回到生效的默认档位（或不显示档位），不弹提示。
与现状一致，只是判定改用 `facts`。

## 7. 可观测性

- `launcher.ts` 的 stderr 处理加逐行回调，desktop main 用 `[runtime-host]` 前缀转发到自己的 `console.error`
  （开发时进 dev 日志，打包后进 Electron 的日志文件）。现有的尾部环形缓冲保留，供 candidate 退出诊断。
- Host 刷新成功也记一行：`fetchedAt`、digest、removals 数量。失败一行带原因。
- discovery 自动刷新同样一进一出各一行。

## 8. 打包快照与流程

- 立即：enterprise 分支跑一次 `npm run refresh:model-metadata`，提交 snapshot 与 generated 两个文件。这一步 5 分钟，
  单独成一个提交，当天治标。
- `docs/enterprise/release-checklist.md` 加固定项：发版前刷新快照；上游同步时顺带。
- 上游已有 `model-metadata-upkeep.yml`，enterprise 分支不再另建流程。

## 9. 影响面

| 层 | 文件 | 改动 |
|---|---|---|
| core | `llm-connections.ts` | `ModelInfo.thinking` |
| core | `model-thinking.ts` | `ModelThinkingFacts`、`resolveModelThinking`；删除 `thinkingVariantsForConnection` / `resolveThinkingLevel` / `thinkingOptionsForModel` 对外导出 |
| core | `model-catalog.ts` | `ModelCatalogEntry.thinking` 替换 `thinkingLevels` |
| core | `chat-model-choice.ts` | `ChatModelChoice.thinking` |
| core | `runtime-policy/connection-catalog-codec.ts` | 模型行 `thinking` 校验 |
| core | `models-dev-refresh.ts` | 投影 digest |
| runtime | `model-fetcher.ts` | Codex / Copilot / OpenRouter 三个 fetcher 保留自述 |
| runtime | `model-factory.ts` | 改用 `facts`，删两处元数据推导 |
| storage | `runtime-policy/connection-catalog-document.ts` | `SCHEMA_VERSION = 3`、`lastDiscovery` |
| storage | 新 `runtime-policy/model-metadata-cache-document.ts` | 缓存文档 |
| runtime-host | `server/model-metadata-refresh.ts` | 缓存加载、重试、周期、状态 |
| runtime-host | `server/execution-composition.ts` | 启动顺序 |
| runtime-host | `server/connection-effect-coordinator.ts` | discovery 新鲜度调度 |
| runtime-host | `server/session-catalog-coordinator.ts`、`execution-model-authority.ts` | 校验与下发改用 `facts` |
| runtime-host | `client/launcher.ts`、protocol | stderr 回调；`catalog.metadata.*` |
| desktop main | `runtime-host-boot.ts`、`runtime-host-connections-ipc-main.ts` | 日志转发；状态 IPC |
| desktop renderer | `ModelMenu.tsx`、`ChatInput.tsx`、`ConnectionModelsSection.tsx`、`SubagentEditor.tsx`、copy 三语 | 6.1 / 6.2 |
| tests | `model-thinking.test.ts`、`model-catalog.test.ts`、`model-fetcher.test.ts`、`model-metadata-refresh.test.ts`、codec 测试、tool-surface golden 若受影响 | 每期同步 |

## 10. 分期与验收

**Phase 0 · 快照刷新**（5 分钟，独立提交）
验收：`gpt-6-*`、`anthropic/claude-opus-5.5` 在打包快照里有 `thinkingOptions`；重启后不依赖网络也显示 effort。

**Phase 1 · provider 自述 + 唯一解析器 + 运行时改用结果 + discovery 新鲜度（5.2）**（P1 / P4 / P6，P5 的数据基础）
验收：
- Codex 连接重新获取模型后，`connection-catalog.json` 的行带 `thinking`；断网启动 effort 仍显示，且与 Codex 后端一致。
- 选"模型默认"时 Codex 请求体带 `reasoning.effort = default_reasoning_level`，且有 reasoning summary。
- `session-catalog-coordinator` 拒绝未声明档位的行为不变，测试覆盖三层来源各一例。
- `thinkingVariantsForConnection` 等旧导出无引用。
- 24 小时以上未刷新的 fetched 连接启动后自动重跑 discovery，needs_reauth 的跳过。

**Phase 2 · models.dev 缓存 / 重试 / 周期**（P2 / P3）
验收：
- 首次成功后杀网重启，`active === 'cache'`，effort 与成功时一致。
- 模拟 30 秒超时三次失败，日志三行，状态 `failed`，现状不变；第四次成功后 publish 一次。

**Phase 3 · UI 未知态 + 目录状态条 + stderr 转发**（P5 / 可观测）
验收：
- 一个无任何来源的模型：菜单显示 effort 行"未声明"，入口能到声明面板；声明后立即变为可选档位。
- 设置页能看到目录来源与时间，手动刷新可用，失败原因可见。
- dev 日志里能看到 `[runtime-host] models.dev …` 行。

每期 gates 不变：`npm run typecheck`、`npx biome check packages apps`、相关包测试、后台全量 `npm test`；
渲染层改动后按 relaunch 流程重建 renderer 再起 App。

## 11. 决定（2026-09-24，owner 授权按最合理方案执行）

- **D1 用户声明优先于 provider 自述。** 用户声明是显式动作且可收窄；声明面板用 provider 自述预填，差异可见。
- **D2 未知态显示 effort 行，值"未声明"，给去设置声明的入口。** 隐藏会让"Maka 不认识"和"模型不支持"无法区分。
- **D3 "模型默认"时，provider 给了默认档位就显式发，没给就省略。** 显式发让请求体和日志可对账，与 Codex CLI 一致。
- **D4 discovery 自动刷新周期 24 小时，串行，needs_reauth 跳过。**
- **D5 schema 升 3 不写迁移；5.2 的自动 discovery 提前到 Phase 1，** 这样升级后第一次启动就把 `thinking` 补进旧文档，没有空窗。

## 12. 实现记录（2026-09-25）

四期一次做完，未提交。和上文方案的出入如下，每条都是实现时读代码后的调整。

- **字段名沿用 `thinkingLevels`。** 方案 4.2 说用 `thinking` 对象替换，实际在 `ModelCatalogEntry` / `ChatModelChoice`
  上保留 `thinkingLevels`，旁边加 `defaultThinkingLevel`、`thinkingSource`、`reasoningSupport`（choice 另有
  `thinkingDeclarable`）。CLI 的 TUI 和 ACP 有三十多处读 `thinkingLevels`，改名只制造改动不增加信息。
  `ModelInfo`（存储的模型行）同样用 `thinkingLevels` + `defaultThinkingLevel`，和用户声明 `ModelOverride.thinkingLevels`
  同名。
- **解析器签名。** `resolveModelThinking(connection, modelId)`，`connection` 只需 `providerType` / `models` /
  `modelOverrides`，所以目录条目、Session 校验（`session-catalog-coordinator`）和线上（`model-factory`，拿的是
  `RuntimeExecutionConnection`）直接传各自手里的对象，不需要 4.4 设想的额外下发。`thinkingVariantsForConnection`
  已删除；`resolveThinkingLevel` 保留名字，内部改走解析器。`thinkingOptionsForModel` 仍被 `model-factory` 用来决定
  线上形状（off 的编码、Claude 的 adaptive/legacy），这是"档位 → wire"的知识，不是档位列表。
- **reasoning summary 的判定。** 改为"解析结果说会推理，或者模型 id 属于 OpenAI 推理家族"。后半句保留按名字判断，
  因为这是端点接不接受 `reasoning.summary` 的兼容问题：中转站上的 `gpt-5.x` 接受它，`gpt-4o` 不接受，而中转站的
  模型不在任何目录里。用户给中转模型声明了档位后，也会请求摘要。
- **"模型默认"的线上行为。** 删掉了"OpenAI 家族默认 medium"。provider 声明了默认档位就显式发（Codex），否则省略。
  这意味着 OpenAI API、OpenRouter、中转站上的 GPT 模型选"模型默认"时不再带 `reasoning_effort: medium`，由服务端
  自己的默认决定。
- **OpenRouter 不做 provider 层。** 它的 `/models` 只有一个 `supported_parameters: ['reasoning']` 标记，映射成
  low/medium/high 会盖掉 models.dev 给出的更完整的档位（例如 claude-opus-5.5 的 max）。OpenRouter 继续走目录层，
  靠 Phase 2 的缓存保持新鲜。provider 层目前是 Codex 和 Copilot。
- **不升 schema。** 新字段在模型行上都是可选的，v2 文档原样可读，不需要 v3 和迁移。discovery 自动刷新把
  `modelsFetchedAt` 早于 `MODEL_INVENTORY_FACTS_SINCE`（2026-09-25）的清单一律视为过期，所以升级后第一次启动约 15 秒
  就会把 Codex 连接的档位补上。
- **模型清单自动刷新**：`packages/runtime-host/src/server/model-inventory-refresh.ts`。启动 15 秒后第一次检查，之后
  每小时检查一次，清单超过 24 小时或早于上面那个时间点就串行重跑 `connection.models.fetch`。
- **models.dev 刷新**：`model-metadata-refresh.ts` 重写。启动先 `loadModelMetadataCache` 装载
  `<storage root>/model-metadata-cache.json`（带 sha256 摘要，不符就丢弃），再后台刷新；超时 30 秒，失败按
  5 秒 / 30 秒 / 5 分钟重试，之后每天一次；某个 provider 缺失或形状不对只影响它自己
  （`projectModelsDevMetadataPerProvider`），表内容真变了才通知客户端。生成脚本仍整体严格。
- **不做 stderr 转发。** Host 的 console 输出早已进入 `runtimeHostLogBuffer`，桌面端的诊断导出会通过
  `host.diagnostics.query` 带上它。原先"用户永远看不到"说重了：诊断包里看得到，界面上看不到。界面这一半由设置页的
  目录状态行补上。
- **目录状态**：新增 Host 操作 `model-catalog.status.query` / `model-catalog.refresh`，桌面端经
  `connections:catalogStatus` / `connections:refreshCatalog` 到设置 › 模型页的「模型目录」一行，显示来源、更新时间、
  最近一次失败原因和"立即刷新"。
- **"未声明"入口只对中转站。** 只有 openai-compatible / openai-responses-compatible 连接在设置里有声明面板，
  其他 provider 没有可去的地方，所以 `thinkingDeclarable` 为假时仍不显示 effort 行。入口打开的是设置 › 模型分区，
  设置页没有逐个连接的深链接。声明面板的"provider 预填"不做：中转站的 discovery 不产生 provider 自述，预填没有来源。
- **设置里的"思考"标签**显示来源：思考 · 自定义 / 来自服务商 / 来自目录。
- **chip 只显示生效档位**（2026-09-25 owner 看过实物后）："模型默认 · 中"把模型名挤成了"GP…"，所以 chip 上只写档位本身，"模型默认"只在菜单里出现。

### Phase 0 附带修正

刷新快照时顺带处理了上游变化带出的问题：Kimi 映射改到 `kimi-code-plan-cn`（Maka 的 Kimi Coding Plan 连 `api.kimi.com`，对应 cn 站点；review 时从 global 改正）；生成脚本放行只带 `body` 的
provider 覆盖；DeepSeek 兜底列表和环境变量种子换成 `deepseek-flash`（`deepseek-v4-flash` 与 vision 预览被上游标为
弃用），但 `deepseek-flash` 仍走 chat 线路，不进 Responses / 托管搜索：那份契约只对 V4 的两个 id 有依据；Fireworks 推荐模型换成 `kimi-k3` 并过滤弃用模型；opencode-free 把 09-02 那版种子追加到历史种子表，
这样按旧种子建的连接会跟随新种子。

### Review 修正（2026-09-25）

完整 review 后改了这些：

- Kimi 映射从 `kimi-code-plan-global` 改为 `kimi-code-plan-cn`（Maka 连 `api.kimi.com`），快照按 cn 重新生成。
- `deepseek-flash` 不再被当成支持 Responses / 托管搜索：同家族、同日发布只说明像改名，不能证明接口契约，而用户
  已启用的 `deepseek-flash` 原来走 chat，贸然切线路可能直接报错。
- 解析器判断"会不会推理"时先读用户在声明面板里勾的 `capabilities.reasoning`。
- 会话里存的档位若已不在模型档位列表里（刷新后被收窄），chip 和单选组显示实际生效的档位，与线上丢弃行为一致。
- 跳过原因改为稳定代码（`privacy_mode` / `proxy_credential_not_configured`），由客户端按语言显示；此前一律写成隐私模式。
- 设置页目录状态行在连接目录变化（Host 后台换表后会通告）时重新查询。
- 模型列表自动刷新按连接记住上次尝试时间，无论成败 24 小时内不再试；此前失败的连接（如需重新登录）会每小时重试。
- 补了 codec 测试（模型行的档位与默认值、目录条目的来源与档位一致性）和解析器的用户能力声明用例。

仍然存在、没有改的一点：GitHub Copilot 的模型目录被当作账号的权威目录，手动刷新时会剔除账号里消失的模型；
现在自动刷新也会这样做。这和手动刷新一致，是"跟随 provider"的直接结果。
