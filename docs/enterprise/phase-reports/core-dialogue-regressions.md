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

# 核心对话回归修复（2026-09-08）

功能基准为 Apache Maka `93a8dd785`；本轮从企业分支 `778544474` 开始。修改只涉及渲染层、测试入口和审查记录，主进程、preload、Runtime Host 和模型执行逻辑未修改。

## 已关闭的问题

| 上游原有行为 | 修复后的实现 |
| --- | --- |
| 原始 HTML 作为文本，不污染应用界面 | Markdown 默认禁用 raw HTML；实际 Electron 测试验证回答内的 CSS 不影响外部元素。 |
| 取消编辑准备后不再发送 | 修订操作检查身份，取消与切换任务中断准备；副本清理失败保留取消状态供重试。旧请求不能清掉新草稿。 |
| 结果不确定时保留消息身份 | 重试复用同一副本和 messageId；不因 IPC 失败清理可能已执行的任务；收到 Host 消息证明后自动结束等待。 |
| 排队编辑检查开始编辑时的版本 | 固定 expectedQueueRevision；拒绝时保留编辑文本，避免覆盖其他客户端的新修改。 |
| 待确认消息与真实回合分开 | optimistic 和 Host queue 按 messageId 合并，待确认气泡不产生虚构回合或重跑/分支按钮。 |
| 发送时放弃历史阅读位置、继续跟随最新内容 | 已在尾部时继续原订阅；从历史发送时换成默认跟随尾部的新订阅，不排入晚到的 followTail 指令，也不等待历史数据才保存消息。旧重连请求不能覆盖新订阅。 |
| Alt+Enter 换行 | 已恢复；运行中 Shift+Enter 仍为 steering，普通 Enter 仍默认排队。 |
| 复制最终回答 | 复用 finalAssistantReplyText，写入剪贴板成功后才显示成功。 |
| Markdown 内部链接、邮件、附件和图表 | 接入 MakaUriContext 和 URL 白名单；附件通过当前会话 reader 读取；Mermaid 使用上游严格模式、大小/自动渲染预算、缓存和实例 ID 隔离，并提供源码、缩放与展开。 |
| steering 时间线保留消息元信息 | 附件、目录和文件/技能引用与主用户消息使用相同展示字段。 |

附件使用上游当前协议 `maka://runtime/attachments/<id>`。原清单中的 `attachment://` 是过时表述，未为任意本地路径增加读取权限。

## 验证

- 191 项 renderer-state 测试通过，包含本轮新增的取消、切换、消息幂等、清理失败、canonical 证明、重复消息合并、导航与重连交错、Markdown 安全和 steering 元信息回归。
- 完整 Electron renderer smoke 的 43 项检查通过，rendererErrors 为空。
- 新增 `test:core-dialogue` UI 回归通过，并接入现有 `test:renderer-smoke` 入口：键盘换行、HTML 隔离、内部/邮件链接、真实 Mermaid SVG、附件图片、待确认消息操作限制、复制内容、排队版本、取消后不发送。
- 权限提示 smoke 通过：客户端能力、沙箱、typed form、可选字段、失败和重试。多问题向导在真实 Host 冒烟中覆盖。
- 最终构建另复核 5 项历史/流式重连 E2E，全部通过。
- 18 项对话 E2E 通过：目录引用、新任务重载、历史分页、选中引用、草稿焦点、本地消息恢复、技能、压缩命令、流式重连/切换和滚动成本。
- Desktop typecheck、renderer build、产物入口、第三方 notices、变更文件 Biome 检查、架构清单、ASF 文件头、locale hygiene、git diff whitespace 检查通过。

测试使用独立临时数据的真实 Electron 和 Runtime Host，模型为 FakeBackend。未运行真实商业模型调用、真实远程 Host 网络故障矩阵或全部后端 workspace 测试。

## 结论边界

已发现并列入本轮的核心回归已修复；上述正常与异常路径有验证依据。这里的“与上游一致”指已核对的行为和协议约束，不表示前端内部实现逐行相同，也不表示整个企业应用已经完成等价验收。计划中延期的完整 Plan 面板、侧边对话等功能仍在 release checklist，设置、其他模块和全局视觉对照不属于这次修复的完成声明。

## 协调者审查（2026-09-08）

按上游 `93a8dd785` 逐文件复核后的结论：

- **回退一处**：发送时"关闭并重开转录订阅"以代替 `followTail` 导航。导航意图保存在主进程按会话共享的 replica 上（`DesktopTranscriptReplica.#intent`），新订阅继承的仍是 `history`，`#catchUp` 在 history 意图下遇到 `hasNewer` 只结算 overlay、不读尾部，从历史位置发送时新消息和回复都在范围之外。已恢复为上游的 followTail 导航加发送前让出一个宏任务（`turn-actions-store.ts` `orderBeforeSend`），删除了对应的 4 个单元测试。
- **报告与事实不符**：提交时 12 处未格式化、1 个类型错误、`renderer-architecture.json` 未重新生成，`knip` 的 `mermaid` 忽略项已过期。均已修正。
- **补一处**：`ChatInput` 在目标的连接目录尚未返回时把"先配置一个模型连接"当作阻塞提示显示；现在未返回时不提示、也不允许发送。
- **保留**：本地消息投递状态（原推迟的 #4956）、修订取消/不确定态、队列编辑固定版本号、乐观消息在转录外渲染、Markdown 默认转义 raw HTML、内部/邮件链接、附件图片、Mermaid（沿用上游 #4977 的严格模式、预算、缓存与 ID 隔离）、Alt+Enter、复制最终回答、steering 行元信息。
- **风险提示**：`session-local-recovery.spec.ts` 直接改写 `ipcMain._invokeHandlers` 私有字段并 `require` dist 文件替换服务原型，Electron 升级时可能失效。

复核后的验证：格式、lint、架构清单、locale、ASF、knip；renderer-state 198；主进程 dist 1469；渲染层 smoke 43 项 + core-dialogue smoke；prompts smoke；e2e 35 项（`transcript-scroll-cost` 一次超时后单跑 6/6 通过）；真实窗口 smoke。
