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

# Maka organization server

员工登录、组织管理后台和模型网关。设计见 [模型接入与网关设计](../../docs/enterprise/model-gateway-refactor-design.md) 和 [管理后台](../../docs/enterprise/admin-console-plan.md)。

## 本地启动

```sh
npm --workspace @maka/core run build && npm --workspace @maka/platform-protocol run build
npm --workspace @maka/server run build
source apps/server/env.local.sh
npm --workspace @maka/server start
```

服务只连接 `DATABASE_URL` 指定的数据库，启动时建好当前版本的表。数据库结构只有一个初始迁移：版本发布前改结构，直接清空开发库重建。

## 模型提供商与模型

管理员在后台“模型提供商”页添加提供商：选类型（Anthropic、OpenAI、Google Gemini、OpenRouter、Google Vertex AI、自定义服务）→ 填密钥 → 读取它的模型列表 → 勾选开放给员工的模型。模型列表都从提供商读取，Vertex AI 读 Model Garden 的 Claude 和 Gemini；不提供手动输入模型 ID。读取列表不会运行模型。

- 提供商建好后，类型、地址、Vertex 的项目和区域不能改；名称、密钥、开关可以改。换密钥前先用新密钥读一次模型列表，被拒就不保存。
- 每个组织模型固定属于一个提供商的一个模型，发布时确定它的调用契约（协议、提供商的模型 ID、能力），之后不变。

## 网关

员工端用自己的 SDK 按模型的协议组好请求，发到对应路径：

| 协议 | 路径 |
|---|---|
| Anthropic Messages | `POST /model/anthropic/v1/messages` |
| OpenAI Chat Completions | `POST /model/openai/v1/chat/completions` |
| OpenAI Responses | `POST /model/openai/v1/responses` |
| Google generateContent | `POST /model/gemini/v1beta/models/:model:(stream)generateContent` |

网关只转发：

1. 检查：员工已登录、模型对员工开放且提供商开着、额度没用完。不通过时由网关自己回答（协议原生的错误结构，加 `maka.code` 和 `x-maka-error` 头），请求不会发出去。
2. 只改必须改的：把模型 ID 换成提供商的模型 ID、换上组织的密钥、补 Vertex 的外层字段，Responses 加 `store: false`，Chat 流式加 `include_usage`；去掉员工能用来指定工作区，或改变 OpenRouter 路由、数据策略、按次计费插件的字段。消息内容不动。
3. 提供商的回答原样返回：状态码、正文、流，以及 SDK 会读的 `retry-after`、`x-should-retry`、`request-id`。网关只在旁边读出用量，请求结束时写一行 `model_usage`。

网关不记任何对话状态，也不预扣额度：发出前只看这个人已经用掉的是否超额。提供商连不上时返回 502 `upstream_unavailable`，只有确定一个字节都没发出去时才标记可以重试。

## 验证

```sh
npm --workspace @maka/server run test:dist
```

服务端测试使用 PGlite 和模拟的提供商，包括各协议用真实 SDK 的往返、原样转发、网关自己的拒绝、额度、取消、流中断，以及模型列表的读取和发布。真实提供商账号（尤其 Vertex AI 的 Model Garden 列表和调用）需要配好账号另行验证。
