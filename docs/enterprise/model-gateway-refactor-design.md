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

# 模型接入与网关设计

2026-10-01。取代此前同名草案（多来源路由、对话绑定、预扣额度那一版）。产品前提：还没有发布，不兼容旧数据和旧接口，数据库只有一个初始迁移。

## 1. 结论

管理员在后台接入**模型提供商**（公司在某个服务商的账号），从它的模型列表里勾选开放给员工的模型。员工在 Maka 里直接选模型，请求由桌面端用自己的 SDK 按该模型的原生协议组好，经组织服务器的网关发给提供商。

**网关只转发。** 它检查身份、模型和额度，换上组织的密钥和提供商的模型 ID，把提供商的回答原样还回去，旁边读出用量记账。它不组装、不改写消息，不判断回答算不算成功，不记对话状态，不预扣额度。

## 2. 管理后台

导航“模型”分组：**模型提供商**（英文 LLM Provider）在上，**已开放模型**（英文 Published models）在下。界面不出现“连接”“上游”“路由”。

**添加提供商**（三步）：

1. 选类型：官方 API（Anthropic、OpenAI、Google Gemini）、聚合服务（OpenRouter）、云平台（Google Vertex AI）、自定义服务（在第二步选 API 类型：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses）。
2. 填写：名称（可空，默认用类型名，重名自动加序号）、API Key 或服务账号 JSON（Vertex 另填项目和区域）、自定义服务的地址；官方服务的地址覆盖收在“高级设置”里。点“获取模型”读取列表。
3. 选模型：搜索、全选结果、清空，显示能力摘要。“保存并开放 N 个模型”，或“只保存提供商”。

模型列表一律从提供商读取，**没有手动输入模型 ID**。读取列表不运行模型；密钥被拒时停在第二步说明原因。

**提供商详情**：它的模型（开关、设置）、“添加模型”（重新读取列表，已开放的标“已添加”）、设置（改名、换密钥、启停、删除）。类型、地址、Vertex 项目和区域建好后不能改；要换就新建一个提供商。

**已开放模型**页：全部组织模型，显示名称、所属提供商、额度倍率、启用开关；设置里改名称、倍率、显示顺序；可删除。

## 3. 对象与数据

| 表 | 内容 |
|---|---|
| `model_providers` | 名称（唯一）、类型、非秘密配置（地址或 Vertex 项目/区域）、密封的凭据、开关、`revision` |
| `organization_models` | `m_…` 不变 ID、所属提供商（`ON DELETE RESTRICT`）、提供商的模型 ID、显示名、调用契约、额度倍率、开关、顺序、`revision`；`(提供商, 提供商模型 ID)` 唯一 |
| `provider_catalog_snapshots` | 某管理员读到的模型列表，15 分钟有效，绑定账号指纹（含凭据的带密钥哈希，不存凭据）和已有提供商的 `revision` |
| `admin_mutations` | 新建和发布的幂等结果，保留一天 |
| `model_catalog_state` | 组织模型列表的修订号，桌面端据此知道列表变了 |
| `model_usage` | 每个请求结束时一行：用户、模型、提供商、协议、各类 token、加权额度、`reported`/`estimated`、`ok`/`error`/`cancelled`/`incomplete`、HTTP 状态、耗时、提供商请求 ID |

每次修改带上读到的 `revision`，对不上回 409 `revision_conflict`，页面重新读取。新建和发布带 `idempotencyKey`，同一个 key 同样的请求返回第一次的结果，不同的请求回 409。发布时只认快照里的模型，页面只提交要发布的 ID，不能指定能力或协议。

## 4. 接入类型与调用契约

`packages/core/src/model-gateway.ts` 是服务端、后台和桌面端共用的定义。

**调用配置**（profile）决定桌面端怎么调用：协议，以及按哪个桌面端服务商类型的既有规则处理思考参数、原生工具、缓存标记等。

| profile | 协议 | 桌面端服务商类型 |
|---|---|---|
| `anthropic` | Anthropic Messages | `anthropic` |
| `openai-responses` | OpenAI Responses | `openai` |
| `google` | Google generateContent | `google` |
| `openrouter-chat` | OpenAI Chat | `openrouter` |
| `compatible-anthropic` | Anthropic Messages | `anthropic-compatible` |
| `compatible-chat` | OpenAI Chat | `openai-compatible` |
| `compatible-responses` | OpenAI Responses | `openai-responses-compatible` |

自定义服务用 compatible 配置，因此不会打开只有官方 API 才有的功能，和桌面端直连自定义服务的行为一致。

**接入类型**：

| 类型 | 配置 | 模型列表 |
|---|---|---|
| Anthropic | `anthropic` | `GET /v1/models`，分页 |
| OpenAI | `openai-responses` | `GET /v1/models`，按名称挑出对话模型 |
| Google Gemini | `google` | `GET /v1beta/models`，支持 `generateContent` 的 |
| OpenRouter | `openrouter-chat` | `GET /api/v1/models/user`（账号范围），只要输出文本的 |
| Google Vertex AI | Claude 用 `anthropic`，Gemini 用 `google` | `GET https://aiplatform.googleapis.com/v1beta1/publishers/{anthropic,google}/models`（Model Garden，服务账号鉴权），Claude 带日期版本时用 `名称@日期` 调用 |
| 自定义 · Anthropic / Chat / Responses | 对应 compatible 配置 | 服务自己的 `/models`，不按名称筛选 |

自定义 Gemini 兼容服务不支持（桌面端也没有这一类，需求出现再加）。

自定义服务的地址和桌面端直连时一样处理：Chat 原样使用，Responses 去掉末尾的 `/responses`，Anthropic 保证末尾正好一个 `/v1`。官方服务在“高级设置”里覆盖的地址没有版本号时补上（Gemini 补 `/v1beta`，其余补 `/v1`）。

**调用契约**在发布时生成并固定：协议、配置、提供商的模型 ID（交给 SDK）、查模型资料用的引用、能力（上下文、输出上限、输入模态、工具、思考档位等）。列表明确说不支持的能力就不支持；资料里没有的可选能力（思考、结构化输出）默认关；工具调用除非列表或资料明确说不支持，否则视为支持（和桌面端直连一致，否则新模型和内网模型用不了工具）。

## 5. 网关

| 协议 | 路径 |
|---|---|
| Anthropic Messages | `POST /model/anthropic/v1/messages` |
| OpenAI Chat | `POST /model/openai/v1/chat/completions` |
| OpenAI Responses | `POST /model/openai/v1/responses` |
| Google | `POST /model/gemini/v1beta/models/:model:generateContent`、`:streamGenerateContent` |

**请求**：桌面端带组织令牌、`x-maka-gateway-version`、`x-maka-model-id: m_…`、客户端版本；正文是 SDK 组好的原生请求，模型字段已是提供商的模型 ID。

**每个请求**：

1. 版本对、已登录、模型开放且提供商开着、路径和模型协议一致、额度没超（只看已用量）。
2. 转发前只改：模型 ID（Google 和 Vertex 在路径里）、认证（Anthropic `x-api-key`、OpenAI/OpenRouter Bearer、Gemini `x-goog-api-key`、Vertex 服务账号换的 Bearer）、Vertex 外层字段（`anthropic_version`、发布商路径）、`store: false`（Responses，不让提供商留存对话）、`stream_options.include_usage`（Chat 流式，否则拿不到用量）。去掉 `workspace_id`、`user_profile_id`，以及 OpenRouter 的 `models`/`fallbacks`/`route`（未开放的模型和路由）、`provider`（服务商与数据策略偏好）、`plugins`（按次计费的联网搜索，token 计不到）。员工的令牌和 SDK 自带的密钥不会转给提供商。重定向不跟随。
3. 提供商的回答原样返回：状态码、正文或流，加上 SDK 读的 `content-type`、`request-id`/`x-request-id`、`retry-after`、`retry-after-ms`、`x-should-retry`。
4. 结束时写一行用量：非 2xx 记 `error`；员工中途断开记 `cancelled` 并中止上游；流里有错误事件记 `error`；流没到结束标记就断了记 `incomplete`；否则 `ok`。

**网关自己的拒绝**用协议原生的错误结构，加 `maka: { code, retryAt? }` 和 `x-maka-error` 头，桌面端据此和提供商的错误区分（例如只在网关说 `unauthenticated` 时才刷新组织令牌）：

| 代码 | 状态 | 何时 |
|---|---|---|
| `unauthenticated` | 401 | 组织令牌无效 |
| `model_not_allowed` | 403 | 模型或其提供商已关闭、已删除 |
| `quota_exceeded` | 429 | 额度用完，`retryAt` 是重置时间；`x-should-retry: false` |
| `upgrade_required` | 409 / 426 | 网关版本不一致（409），或桌面端版本低于服务器要求（426） |
| `invalid_request` | 400 | 正文不是 JSON 对象、路径和模型协议不符 |
| `upstream_unavailable` | 502 | 提供商连不上，或凭据用不了（解不开、Google 不换令牌）；只有连接本身失败、请求确定没发出（连接被拒、DNS、TLS）时 `x-should-retry: true` |

**超时**：从发出开始，十分钟没有收到任何字节就中止；有字节就重新计时，所以长回答不会被切断。

**没有的东西**：对话绑定（模型只属于一个提供商，提供商的身份建好后不能改，换密钥不影响进行中的对话）、自动切换备用提供商、预扣额度、检查消息内容、按结束原因改写回答。

## 6. 额度与用量

额度单位 = `(输入 + 输出 × 5 + 缓存写 × 1.25 + 缓存读 × 0.1) × 模型倍率`。各协议的口径在网关统一：Anthropic 的缓存单独计；OpenAI 和 Gemini 的输入里含缓存读，扣掉后再计；推理 token 已含在输出里（Gemini 的 thoughts 单独报，加进输出），不重复计。

只在提供商报了完整用量、回答也走到结束时记 `reported`；否则估算，记 `estimated`：输出按已看到的内容，输入按请求正文的文字（图片等编码数据每个按固定量计）。提供商直接返回错误或根本没连上时记 0。单个超大的流事件（如内嵌图片）跳过不读，后面的事件照常计量。发出前只检查已用量是否超额，所以额度用完前最后几个并发请求可能略超，内部使用可以接受。

## 7. 桌面端

- 登录后读 `GET /model/catalog`：每个开放的模型给出 ID、显示名、调用契约和可用状态（`available`，或提供商已停用 `provider_disabled`，后者照常列出但不能调用，对话里的名字不丢）。修订号变了就刷新。
- 调用时按契约选协议和 SDK，SDK 拿到的是提供商的模型 ID；思考参数、原生工具、ApplyPatch、上下文上限等按配置对应的服务商类型和真实模型资料判断，不再把组织模型一律当 Claude。
- 某个模型的契约解不开时只跳过这个模型，不影响整个列表。
- 提供商的错误按该服务商类型的原生规则分类；认证、权限、余额类错误提示“联系管理员”。

## 8. 管理接口（`/admin/api`，管理员会话 + CSRF）

| 接口 | 用途 |
|---|---|
| `GET /model-providers`、`GET /model-providers/:id` | 列表；详情含它的模型 |
| `POST /model-providers/discover` | 用草稿读取模型列表，返回快照 |
| `POST /model-providers` | `{ draft, publish: { snapshotId, selections, idempotencyKey } }` 新建并发布；`selections` 可为空 |
| `POST /model-providers/:id/discover`、`/publish` | 已有提供商重新读取列表、再发布（带 `expectedRevision`） |
| `PATCH /model-providers/:id` | 改名称、换密钥（先验证）、启停 |
| `DELETE /model-providers/:id` | 还有模型时拒绝（`provider_in_use`） |
| `GET /models`、`PATCH /models/:id`、`DELETE /models/:id` | 组织模型的名称、倍率、顺序、开关、删除 |

拒绝时回 `{ error: { code, message } }`，代码：`invalid_request`、`not_found`、`revision_conflict`、`catalog_expired`、`credentials_rejected`、`provider_in_use`、`name_taken`、`idempotency_conflict`。审计记录 `model_provider.created/updated/deleted`、`model.published/updated/deleted`，带名称和改了哪些字段。

## 9. 验证情况

已用 PGlite 和模拟的提供商测试：各协议用真实 SDK 往返、原样转发、网关拒绝、额度、取消和中断、换密钥后继续、模型列表读取（含 Vertex Model Garden 的列表格式）与发布、快照与幂等。

**未验证**：真实提供商账号的调用，尤其是 Vertex AI 的 Model Garden 列表（`versionId` 的取值和 `名称@日期` 的调用方式按 Google 发现文档和 Anthropic 的 Vertex SDK 推断）和 OpenRouter 推理细节的回传。
