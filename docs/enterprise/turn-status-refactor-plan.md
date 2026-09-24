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

# 工具组渲染重构方案：对齐 claude.ai 新版 TurnStatus

2026-09-24。参考对象是 claude.ai 新版对话界面（`/cowork`、`/chat` 路由下的 hub transcript engine）。
依据有两类：浏览器实测，和前端代码（本地快照在会话 scratchpad，不入仓库）。每条结论标了来源：
**实测** / **读代码** / **推断** / **未查**。

## 1. 参考的做法

### 1.1 一个 turn 的结构（实测）

```
[TurnStatus]   Used 24 tools, updated tasks, ran 2 commands ▾      ← 一行灰字，默认折叠
[Prose]        回复正文（可以有多段）
[文件卡片]      Session injections · Document · MD   [Download ▾]  ← 在所有正文之后
[消息操作栏]
```

- 旧版的"每段工具之间一个组、行首图标、左侧时间线竖线"全部取消。
- TurnStatus 展开后是一张卡片：圆角 12px，用阴影画边框（`rounded-card shadow-card-ring`），`divide-y` 分隔线，
  里面是**扁平**的步骤列表，没有图标。
- 步骤行 = 灰色动词短语 + 深色对象，例如：
  - `Added task` **测试 project_info** ›
  - `Searched project knowledge` **user_preferences 偏好通道** ›
  - `Saved pt-test-nested.md to the project` tests/pt-test-nested.md ›
  - `Couldn't read 不存在的文件.md from the project` <span style="color:#8e2626">Failed</span> ›
  - `Completed task` **测试 project_info**（没有 ›，不能展开）
  - `Loaded tools`（ToolSearch）
  - `Locate skill directories on disk`（Bash 的 description）
- 带 › 的行可以展开，Bash 展开后是 **Request**（高亮后的输入）+ **Response**（输出，超长时显示 "Output truncated"）。
  其他工具展开后是什么样：**未查**。
- 实测到的摘要：`Ran 2 commands`、`Used 4 tools, ran 3 commands`、`Created a file, shared a file`、
  `Updated tasks, checked tasks, checked a task`、`Read 2 memories, used a tool`、
  `Used 13 tools, updated tasks, and 3 more steps`。

### 1.2 分组规则（读代码，`shared-12` 的 `qm`/`eh`）

- 思考和工具调用可以并进步骤组。
- 正文要么折进组里，要么显示出来；**显示出来的正文会结束当前组**。
- 某些工具调用被标为 `blocking`，也会结束当前组。**推断**是等待用户操作的调用（AskUserQuestion、权限请求）。
- 因此常见情况是每个回复只有一个 TurnStatus、位于正文上方。中间有正文被显示时，会出现多个组。
  实测看到的都只有一个。
- 等待用户时 TurnStatus 进入 `blocked` 状态，见 §1.5。

### 1.3 中间文字的折叠（读代码 + 实测）

- 每段正文要判定是"显示"还是"折叠"：服务端下发 `narration_fold`，或者由客户端打分模型判定（阈值 0.107）。
- 被折叠的文字保留在 TurnStatus 里，界面上看不到，但页内搜索能找到（`data-cds-findable`）。
- **实测**："Done — 完整原文已写入文件。" 这句直播时是显示的，turn 结束后被折进 TurnStatus
  （对应 flag `narrationTailShownEarly`）。

### 1.4 SendUserMessage 和 SendUserFile（读代码）

- SendUserMessage 在整理消息时被换成 `{ type: "text", fromSendUserMessage: true }`。原来的工具调用和返回结果都丢弃，
  **不产生步骤行**；折叠判定里它永远是"显示"（`ccba96ec3` L46–48、L278–281；`shared-12` L1214）。
  - 例外：子 agent 内的调用不转换；清理后为空的消息不画。
  - **未查**：显示的文字最终是否一定画成卡片外的 Prose；服务端下发路径（`source: "server"`）是否同样转换。
- SendUserFile 在组里算一步（"shared a file"），文件卡片放在所有正文之后（实测）。

### 1.5 等待用户（用户截图 + 读代码）

```
◉  [Needs your input] ›                                   ← TurnStatus 处于 blocked 状态
                                                             左侧橙色圆环，文案在橙底药丸里
┌─────────────────────────────────────────────────────────┐
│ Claude wants to use a folder on your computer ▾         │ ← 请求卡片，停靠在输入框上方
│ From the tool:                          （斜体，灰色）  │
│ ┌ 灰底等宽块：工具给出的说明原文 ───────────────────────┐ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌ 灰底键值表：Folder  ~/Desktop                        ┐ │
│ │            Why     测试权限请求流程：…               │ │
│ └──────────────────────────────────────────────────────┘ │
│ [Decline  Esc]                      [Allow once  ⌘ ↵]   │ ← 主按钮是黑底
└─────────────────────────────────────────────────────────┘
[Reply ...]
```

- `shared-15` L4519：TurnStatus 的状态计算是
  "进行中 ? (`blocked` ? `blocked` : `busy`) : (失败 ? `failed` : `done`)"。
  进行中时的文案是 "进行中 ? (`blocked` ? "Needs your input" : 当前状态文字 ?? "Thinking…") : 当前状态文字"。
- 已有两个工具用这种形态（用户确认），截图里是"使用电脑上的文件夹"那个；另一个是哪个工具**未确认**。
  `blocked` 由谁传入**未查**。
- Maka 已经把交互请求放在输入框上方（`components/composer/InteractionPrompts.tsx`：沙箱边界、
  客户端能力、AskUserQuestion、表单），位置相同。缺的是 TurnStatus 的 blocked 状态，
  以及请求卡片的样式（标题带 ▾、"From the tool:"、灰底说明块、键值表、按钮上的快捷键提示）。

### 1.6 样式（实测，浅色主题）

| 元素 | 数值 |
|---|---|
| 摘要行 | 14px/20px，高 32，padding 6px，gap 8px，圆角 8px，灰色字 |
| 展开区 | 上 8px、下 6px |
| 卡片 | 圆角 12px，阴影描边，行间分隔线 |
| 步骤行 | 14px/20px，左右 6px，gap 8px；动词 `rgb(137,135,129)`，对象 `rgb(11,11,11)`，字重都是 400 |
| 展开箭头 | 12px，灰色 |
| Failed | `text-danger` `rgb(142,38,38)`，14px |
| 正文段落 | 15px/22px |

## 2. Maka 现状对照

| 维度 | Maka 现在 | 参考 |
|---|---|---|
| 组的数量 | 每段连续的工作一个组，被正文切开 | 每个回复通常一个，只有显示出来的正文才切组 |
| 组的位置 | 按时间穿插在正文之间 | 通常在正文上方 |
| 中间文字 | 全部作为正文显示 | 播报折进组里，实质内容才显示 |
| 步骤行 | 图标 + 单串标题 + 时间线竖线 | 无图标，动词/对象两色，无竖线，卡片分隔线 |
| 组的折叠 | 直播时显示最近 3 步，结束后折成摘要 | 默认折叠成一行摘要 |
| SendUserMessage | 工具行；按 Markdown 结构分行内或整块，组头计 "N notes" | 转成正文，不是步骤，没有计数 |
| 失败 | 行尾 FailureMark 图标，展开看 ToolFailureBlock | 文案改成 "Couldn't …"，后跟红色 Failed |
| 展开内容 | 各工具专用渲染器（diff、终端、搜索列表等） | Bash 是 Request/Response；其他工具**未查** |

另外，Maka 的系统提示 `30-send-user-message-tool.md` 已经告诉模型"中间文字会被总结、不逐字展示"。
现在的界面和这句话矛盾，重构之后两者就一致了。

## 3. 目标设计

### 3.1 数据层（`packages/ui`）

1. **SendUserMessage 转成正文。** 在 `materialize.ts` 生成时间线时，把 SendUserMessage 调用换成
   `{ kind: 'text', fromSendUserMessage: true }`，不再产生工具项。
   - 直播时文字取自 `argsPreview.message`（`projectToolArgsPreview` 的放行保留）。
   - 结算后取自 `user_message` 结果。
   - 子 agent 内的调用不转换。
   - 只有结算后结果是 `user_message` 才算送达；失败或中断的调用回到普通失败步骤。
2. **正文加折叠标记。** 每个 text 项增加 `fold: 'shown' | 'folded'`，规则见 §6 决策 1。
   `fromSendUserMessage` 的项永远是 `shown`。
3. **重写分组函数。** `groupTurnTimeline` 输出以下几种段：
   - `status`：并进组的思考、工具调用，以及折叠的文字（作为隐藏文本保留，页内搜索能找到）
   - `prose`：显示出来的正文
   - `user`：turn 中途插入的用户消息
   - `ask`：已回答的 AskUserQuestion
   - `files`：统一放在 turn 末尾

   显示出来的正文、插入的用户消息、阻塞型调用都会结束当前 `status` 段。

### 3.2 组件（`apps/desktop/src/renderer/components/session/tools/`）

- `ToolGroup.tsx` 改成 `TurnStatus.tsx`：一行摘要加一个展开箭头，默认折叠；展开后是卡片和步骤列表。
  去掉"直播时显示最近 3 步"的窗口和 "N earlier steps"。
- `ToolRow.tsx` 改成 `TurnStatusStep.tsx`：去掉图标列、StepDot、StepLine、StepGap。一行里依次是动词、对象、
  附加说明（例如路径）、Failed、展开箭头；能展开的行点开后显示内容。
- `ThinkingStep.tsx`：作为卡片里的一步。参考里思考步骤长什么样**未查**，P5 时核对。
- `TranscriptTurn.tsx`：按新的段类型渲染；文件卡片仍然放在最后。

### 3.3 文案（`tool-presentation.ts`、`locales/transcript-copy.ts`）

- `toolRowTitle` 改成 `toolStepLabel(item, locale)`，返回 `{ verb, object?, detail?, failed }`，
  分运行中、完成、失败三种时态。失败时 `verb` 用 "Couldn't …" 的句式。
- `summarizeToolGroup` 改成参考的句式："Used N tools, updated tasks, ran 2 commands"，
  超出的部分写成 "and N more steps"。参考的分档和排序规则到 P3 时再查。
- 参考有时会用服务端生成的摘要（`hubServedSummary`）；Maka 只在本地拼接，不做这一项。

### 3.4 展开内容（`registry.tsx`、`renderers/`）

- 新增默认的 Request / Response 渲染（输入高亮、输出截断提示）。
- 现有的专用渲染器（DiffResult、TerminalResult、SearchResults、SubagentResult、WebSearchResult 等）
  先原样放进展开区，到 P4 再逐个工具对照参考决定去留（见 §6 决策 2）。
- ToolFailureBlock 保留在展开区里。

### 3.5 直播

- 摘要行在运行中显示当前在做什么（没有状态文字时是 "Thinking…"），结算后显示汇总句。
- 等待用户（AskUserQuestion、权限请求、§1.5 那类工具）时，摘要行切到 `blocked`：
  左侧橙色圆环，文案 "Needs your input" 放在橙底药丸里，后面跟 ›。
  请求卡片仍由 `InteractionPrompts` 画在输入框上方，按 §1.5 的样式重做。
- 最近一段播报在直播时先显示；等后面出现新的工具调用、或者 turn 结束时，再折进组里。
- busy / pending / blocked 三种状态的标记和动画，到 P5 时再查参考。

## 4. 删除清单

- `lib/tool-delivery-results.ts`：`isNoteItem`、`readNoteMessage`、`userMessageFitsOneRow`
  （`readUserMessage` 挪到数据层使用）
- `lib/turn-timeline-groups.ts`：`notes` 计数、`deliveryPlacement` 的 inline/block 分支、note 的 delivery 条目
- `renderers/DeliveryResults.tsx`：`UserMessageResult`
- `registry.tsx` 的 `user_message` 分支；`tool-presentation.ts` 中 `user_message` 渲染器 id 和相关分支
- `ToolGroup` 的 `notes` 属性；`transcript-copy.ts` 的 `noteCount`
- `ToolRow` 里所有 `isNote` 分支
- 对应的测试：`tool-delivery.test.tsx` 中 note 相关的用例，以及 `presentation.test.tsx` 里的 note 颜色用例

## 5. 分阶段

每个阶段开始时只针对该阶段的问题查参考，不做大范围逆向。

| 阶段 | 内容 | 开始前要查的参考 | 验证方式 |
|---|---|---|---|
| P1 数据层 | SendUserMessage 转正文、折叠标记、新分组函数 | "显示"的正文画在哪；server 路径 | 单元测试 |
| P2 组件骨架 | TurnStatus / TurnStatusStep，去掉图标和竖线，套用 §1.6 样式 | 无（已实测） | smoke 截图，对照实测数值 |
| P3 文案 | 按工具写 `toolStepLabel`；摘要句；失败句式 | 各工具的文案目录（`shared-msg-*`）；摘要分档规则 | 单元测试 |
| P4 展开内容 | Request/Response；逐个工具核对专用渲染器 | 每个工具在参考里的展开内容 | smoke 截图 |
| P5 直播状态 | 运行中的摘要、播报先显示后折叠、busy/blocked 标记、思考步骤、请求卡片样式 | TurnStatus 标记和动画；`blocked` 由谁传入 | 流式 e2e（`test:streaming-switch`） |
| P6 清理 | 删除 §4 的内容，更新测试 | — | 全量门禁 |

## 6. 需要拍板的决策

1. **中间文字的折叠规则**
   - (a) **位置规则（推荐）**：turn 里某段正文之后如果还有工具调用，它就是播报，折叠；最后一次工具调用之后的正文显示。
     SendUserMessage 永远显示。实现简单，也和系统提示对模型的要求一致：要给人看的中间内容走 SendUserMessage。
     风险是不遵守这条约定的模型（例如 eval 里的 deepseek）会把重要内容写成中间文字而被折起来，
     不过展开组仍然能看到。
   - (b) **移植参考的打分模型**：需要把特征和权重从代码里抽出来（`Gp`/`Jp` 等），工作量和 token 都要多花一轮。
2. **展开内容**：保留 Maka 的专用渲染器，还是统一改成 Request/Response。建议先保留，P4 逐个核对后再定。
3. **服务端摘要**：不做（见 §3.3）。

## 7. 未查清的点

- 参考中"显示"的正文最终是否一定画成卡片外的 Prose，以及 server 路径下 SendUserMessage 的处理
- 除 Bash 以外各工具展开后的内容（Edit 有没有 diff、搜索结果怎么画、子 agent 怎么嵌套）
- 思考块在卡片里的样子
- 直播时摘要行的文案和状态标记
- `blocking` 工具的确切范围；`blocked` 状态由谁传入；除"使用文件夹"外另一个用 Needs your input 形态的工具是哪个
- 摘要句的分档和排序规则、"and N more steps" 从第几项开始

## 8. 实施状态（2026-09-24）

§6 决策 2 按建议执行（展开内容保留 Maka 现有的专用渲染器）。决策 1 先用了位置规则，后来改为移植参考的评分模型：
`lib/narration-fold.ts` 原样照搬参考的特征、标准化常数、权重、偏置和阈值 0.10735。位置规则会把每轮第一段文字也折起来，
和参考不一致。注意：模型按空格计词，中文整段只算一个词，所以中文短句比英文更容易被折叠，这一点和 claude.ai 的行为相同。

### 已完成

- **数据层**（`lib/turn-timeline-groups.ts`）：每段文字按"下一个非文字块"判断显示还是折叠。
  - 后面是思考或普通工具调用：折进组里，成为 `narration` 步骤。
  - 后面是用户消息、turn 结束、AskUserQuestion，或者定时任务卡片：显示。
  - SendUserMessage 转成 `fromSendUserMessage` 正文；运行中取 `argsPreview.message`；结算后只认 `user_message` 结果，
    没送达的调用保留为一步，用来显示失败。
  - 运行中的 AskUserQuestion 是所在组的一步；回答后成为独立的问答记录。
  - SendUserFile 在组里算一步，文件卡片仍然放在 turn 末尾。
- **组件**：`ToolGroup.tsx` 改名为 `TurnStatus.tsx`，`ToolRow.tsx` 改名为 `TurnStatusStep.tsx`。
  - 摘要行默认折叠；运行中显示当前步骤的文案，带闪光效果；结束后显示汇总句。
  - 等待用户时是橙色圆环加药丸（"正在提问"/"需要你的确认"），状态来自 `activeSessionStore.interactions`。
  - 展开区是带分隔线的卡片：没有图标、没有时间线竖线，思考、播报、工具都是卡片里的行。
  - 失败的行文案改为"未能 …"，后面跟红色"失败"，原因在展开区里。
- **文案**：`toolStepLabel` 按参考的 `verb / runningVerb / failedVerb / meta` 结构，覆盖 Bash、Agent、
  Read、Write、Edit、Grep/Glob、WebFetch、WebSearch、Skill、Task 系列、AskUserQuestion、SendUserFile、ToolSearch、记忆工具，
  其余工具沿用原来的 `toolRowTitle`。
  - 摘要加上 "以及另外 N 个步骤"；英文改为只用逗号连接；新增 `share` 桶，SendUserFile 计为"分享了文件"；
    通用工具的摘要改为 "Used a tool / Used N tools"。
- **删除**：note 机制（`userMessageFitsOneRow`、行内/整块判断、"N 条留言"、`UserMessageResult`）、
  时间线几何（`StepDot`、`StepLine`、`StepGap` 等）、旧的 `ThinkingStep` 时间线版本。
- **验证**：
  - 渲染层类型检查通过；`test:renderer-state` 359 个用例全部通过，新增了播报折叠、SendUserMessage、
    等待状态、步骤文案等用例。
  - 用临时预览页在浅色、深色两种主题下截图核对过。
  - 架构快照已更新（只包含本次改名；另外两处原本就不通过的 `ChatInput`、`PermissionModeMenu` 未动）。

- **权限申请卡片**（`components/composer/InteractionPrompts.tsx` 的 `PermissionPrompt`）：沙箱边界请求和客户端能力请求
  改成 §1.5 的样式。
  - 结构：标题带 ⌄，可以收起说明；"来自工具："灰底等宽块列出目标和授权后的结果；灰底键值表是文件夹/文件/网络/网站/服务器/工具，
    以及原因。
  - 按钮："拒绝 Esc"、黑底"本任务允许 ⌘ ↵"。Esc 只在没有别的处理者时生效，输入框里仍然是停止；⌘↵ 在捕获阶段处理。
  - 主目录路径缩写为 `~`。
  - 文案在 `packages/ui/src/conversation-copy.ts`（新增 `permissionCard`，重写 `sandboxBoundary` 和 `clientCapability`）。
  - AskUserQuestion 卡片保持不变（用户确认没问题）。`test:composer-prompts` 通过。

- **直播行即唯一的状态**（第二轮，用户反馈）：
  - 底部状态条 `TurnRunningStatus.tsx` 删除。
  - 动画标记（挂在左侧，和等待时的圆环同一位置）、计时（5 秒后出现，`· 12 秒`）、"仍在处理"提示都挪到正在工作的
    TurnStatus 行上。两个步骤之间保留上一个工具的文案，思考时显示"正在思考…"。
  - 还没有工作组时（刚发送、刚回答完提问、正文中途卡住），用 `TurnStatusPending` 占位；正文流式输出时不再额外显示状态。
  - 末尾的文件卡片不再让直播中的工作组被当成"已完成"（`TurnDeliveryEntry.atFoot`）。
- **直播时显示工具描述**：`packages/core/src/tool-quiet-preview.ts` 把 Bash、Agent 的 `description` 加进直播预览白名单
  （只放行这两个工具，其他工具的 `description` 仍然挡掉），core 重新编译。

- **第三轮修复**（外部复现的问题）：
  - SendUserMessage 交接：工具已完成、但直播帧没带正文（`contentOmitted`）时，继续用参数预览当正文；只有失败、中断、
    或结果不是 `user_message` 时才变成步骤（`readSendUserMessageText`）。
  - 权限卡片的 Esc：改在捕获阶段监听。全局快捷键在 document 上会吞掉所有 Escape，冒泡阶段根本收不到。
    输入框里按 Esc 仍然是停止当前回复。
  - 权限卡片的路径：只按会话所在 Host 的真实 `homePath` 缩写成 `~`（`getAppInfo(host)` 加 `collapseHomePath`），
    `/Users/Shared`、其他账户的目录保留完整路径。
  - `test:composer-prompts` 的 fixture 挂上了真实的 `useShellHotkeys`，并补了路径断言；用旧写法跑这个 smoke 会失败，
    说明它确实能抓住这个问题。
- **直播时的形态**（按参考的 `contentAfter` / `pendingFold` 机制）：
  - 一段文字一旦后面来了工具调用或新文字，就立即打分，运行中也一样；分数低的收进工作组。
  - 正在写的那段话紧跟在工作组后面时，不算结束这个工作组：工作组保持直播（动画标记、计时，状态行显示"正在撰写…"），
    下一个工具调用加入同一个工作组，不会另起一组。所以直播时工作组是连贯的一块，最多只收走最新那一句话。
  - 试过、但放弃的两种做法：
    - 运行中完全不折叠：工作组被过程话切成一段一段，结束后才合成一块，用户实测反馈很差。
    - 末尾提前打分：中文最终回答写到 350 多个字仍不达标，英文要 160 个字左右，回答会一直藏在工作组里。
  - 这一轮运行中，任何时刻都恰好有一处进行中的状态：优先挂在直播中的工作组上；没有直播中的工作组时，
    在末尾补一行 `TurnStatusPending`（标记、"正在撰写…"或"正在处理…"、计时）。这些时刻包括刚发完 SendUserMessage、
    前面没有工作组的第一段话、刚回答完提问、刚插入的用户消息。参考用页面底部的 `chat-footer-spark` 覆盖同样的空档。
    实录参考：在测试会话里跑一轮，每 0.25 秒记录一次结构，确认了 pending → busy → "文字挂在 busy 工作组下" → 发完消息时
    没有 busy 工作组、由底部标记兜底的完整时序。矩阵测试覆盖了 10 种"最后一块"的情况。
  - 验证：`test:streaming-switch` 通过，截图核对了"一个直播工作组 + 下方正在写的一句"的形态；
    `electron-smoke` 此前已通过（列对齐改为正文 +5px）。

- **代码审查修复**（`/code-review high`，10 条发现，核实后修了 8 条）：
  - 权限卡片的 ⌘↵ 和 Esc 在输入框里都不响应，避免在输入框里按 ⌘↵ 时意外批准权限；
    smoke 已覆盖，用旧写法跑会失败。快捷键监听改用 ref，只注册一次。
  - 只含失败 SendUserMessage 的工作组，结束后摘要正常计数，不再一直显示"正在处理…"。
  - 计时按 turn 记住最早的开始时间，在占位行和工作组之间切换时不再归零。
  - 纯思考工作组展开后，显示"思考内容已截断"的提示。
  - "说明 → 思考 → 提问"时，说明保持显示：判断时跳过中间的思考。这一点有意偏离参考，参考会把它折叠。
  - 性能：文字特征按内容缓存；"下一个非文字块"改为一次反向扫描；`liveStatus` 用 `useMemo`。
  - 没修的两条：
    - 中文计词偏差：沿用参考的行为，等产品决定。
    - ~~SendUserMessage 在正文补齐前显示的是预览~~ 已根治：直播 `tool_result` 帧对 `user_message` 结果带上正文
      （`SESSION_TOOL_RESULT_MESSAGE_MAX_BYTES` = 32 KiB 以内；超过的仍省略，等转录补齐，渲染层的预览回退只在这种情况生效）。
      改动在 runtime-host 的线路类型/解码器、事件映射、投影三处；协调器和投影测试各加一条，含解码往返。

- **二次独立复核**（换模型后重读核心文件）：一处修正——直播 turn 里的文字块自始至终带 `live: true`，
  只有 `complete` 才说明写完了。之前"正在撰写…"只看 `live`，文字写完后仍显示"正在撰写…"；改为同时看 `complete`。
  矩阵测试加了对应用例。其余逻辑（分组、折叠、SendUserMessage 交接、计时、快捷键）复核无误。

- **块间距改为参考的模型**（第二次样式修正）：回复内的块列统一 `gap-5`（20px），顶部 `pt-2.5`（气泡下方到第一块文字 44px）；
  TurnStatus 行和占位行 `-my-1.5`（-6px，抵消自身 6px 内边距，文字离正文 20px、盒子离正文 14px）；
  正文、问答卡片、文件卡片不再各自带外边距。问答卡片边框 1px（参考用绝对定位的兄弟元素画 1px 边线），
  问题文字用 secondary 色（参考 rgb 82,81,78）。实测：卡片↔正文 20px，行↔正文 14px。

### 与参考的偏差

- 播报折叠用的是移植过来的客户端评分模型；参考的服务端 `narration_fold` 字段 Maka 没有。直播时的"末尾"文字一律先显示，
  等后面出现工具调用或新文字时再打分；参考在这里还会用末尾特征做一次提前判断，这一步没有移植。
- 摘要只在本地拼接，没有服务端摘要（`hubServedSummary`）。
- 运行中的状态标记只做了 blocked；busy 状态的 spark/clay 动画没有做。
- 思考步骤的样子（"思考过程"一行，展开看全文）是推断的，没有核对参考。
- 权限卡片的主按钮是"本任务允许"，不是参考的 "Allow once"：Maka 的授权作用于整个任务。
  "来自工具："块由 Maka 根据请求自己生成（目标列表加一句授权后的结果），参考里是工具给出的原文。

### 未完成

- 逐个工具核对展开内容（P4）。
- 任务类工具（TaskCreate、TaskUpdate）在直播时拿不到参数（设计上只认提交后的结果），所以在这一轮结束前只显示
  "Updated task"，结束后才显示"完成了任务 #1"。参考是从任务快照里取任务名的，Maka 可以改成从 Progress 面板的任务数据取。
