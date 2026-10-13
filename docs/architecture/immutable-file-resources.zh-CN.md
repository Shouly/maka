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

# 不可变文件资源

> 本文记录文件资源重构的边界。自动化回归与人工验收分开记录；Windows、真实远程 Host 和桌面人工流程仍须在对应环境验收。

本模型面向受支持格式的资料目录（`stateRoot`），不是项目工作目录（`cwd`）。不迁移旧 Artifact ID、旧文件布局或对话中的绝对保存路径。遇到不支持的存储格式应拒绝打开，不得自动清空资料目录。新建聊天、切换项目目录不能绕过资料目录的格式检查。

## 身份与所有权

- Blob 是按 SHA-256 定址的不可变字节；不同业务资源可以共享同一个 Blob。
- Artifact 是稳定的逻辑资源身份，包含 Blob 定位、名称、类型、生产 turn 和来源等不可变描述。
- Session 归属是 `(sessionId, artifactId)`。归属才授予访问权限；知道资源 ID 不授予访问权限。
- 分支只增加归属，不复制字节、不生成替代 ID。增加已有归属是幂等操作。
- 删除只移除当前 Session 的归属。GC 在没有任何归属后才能回收 Blob。身份记录保留为防止 ID 被重新解释的 tombstone。
- 正式子 Agent 交接按接收者、来源 Session 和资源 ID 记录持久完成事实，与新增归属原子提交；它与通知消费标记无关。同一次交接重放只能返回接收者仍持有的文件，不恢复后续删除。记录不授予访问权限、不阻止 Blob GC，随接收者整会话清理；分支和导入保留这份删除后的重放语义。
- 创建内容后提交归属，提交归属前内容必须完整且持久。未发布文件、临时文件有持久 GC 意图；GC 与发布共享写锁。

## 模型使用 path，存储使用 ref

```text
Artifact ID / task-output ref
          ↓ 已提交的 Session 归属与快照绑定
Runtime Host 执行文件视图
          ↓ 当前执行边界允许访问的真实绝对路径
Read / Grep / Bash / Python / SendUserFile
```

- 不可变资源身份、`savedOutput.ref`、`outputRef`、`fileRefs` 继续持久化。路径是定位，不是资源身份。
- 每次组装模型请求时，只解析结构化依赖；先准备真实文件，再给模型 `file_path`。当前附件、历史回放、工具回执、图片 Artifact、后台通知采用同一原则。
- 物化文件形如 `<stateRoot>/file-views/<sessionId>/files/<artifactId>/file-<name>`；后台输出使用 `task-outputs/<taskId>/file-<taskId>.output`。这里的占位符只用于文档；模型拿到的是当前操作系统中的真实绝对路径，不是伪挂载点或换了拼写的 URI。
- 不把 Blob 路径交给模型，不以硬链接或符号链接把执行文件接到 Blob。视图使用独立副本／写时复制，原子替换；缓存被改写或删除后可以重建，不改变资源原始字节。
- 附件、回执和通知在原有展示位置提供名称、真实路径、来源、大小与执行边界是否只读；内部 `session_effect` 不向模型展示。不新增发现工具，也不要求模型从摘要恢复 ID。
- **压缩只改变上下文，不增加文件发现、枚举或清单注入。** 摘要中的路径继续使用。同一环境重启时，资源层恢复原执行位置，不向模型重复列文件。
- 分支或跨资料目录导入确实改变执行位置时，沿用现有 turn injection，在该操作后的首次执行上下文提供迁入文件的新路径。持久 ledger 保存执行环境位置的标记；标记未变化就不追加文件位置提示。该标记不承载资源权限。
- Read 的图像观察保存为不可变 Artifact，原工作图片修改后仍可回放观察时的字节。不保留旧文件 ref 入口或旧图片快照存储适配器。
- Read 只有 `file_path` 文件入口；Grep、Bash、Python、SendUserFile 同样操作实际文件。文件工具不解析资源 URI，不从路径反查归属、切换内容或复用另一个 Blob。
- 历史调用参数、助手原文、摘要、持久回执不做全局路径替换。**所有历史绝对路径都没有分支重绑定语义**；分支或换机器后，由系统提供新环境的文件信息。路径失效时明确失败，不能换成另一份内容。

### 执行环境与权限边界

- 这些路径属于运行 `Read/Bash` 的 Runtime Host。远程 Host 返回远程 Host 的执行路径，不表示该路径也存在于客户端电脑、浏览器工具或另一台执行器上。
- Host 不向 `external` 执行边界伪造本机路径。没有外部文件传输／物化能力时明确标记不可用；嵌入式后端可通过 `AiSdkBackendInput.resolveFilePath` 提供执行环境自己的物化实现。
- Managed 边界会检查路径是否可读，不会为了发布路径自动扩大 sandbox 权限。沙箱不允许访问文件视图时明确报告不可用。
- WorkHub 协调器仍是受限工具面：v1 没有文件工具；v2 使用同一个 Read 文件实现，但共享执行边界收窄到本会话的输入文件视图，不获得普通 Host 文件系统权限。
- 资源服务只在准备文件时校验已提交的归属。子 Agent 输出在同步完成、异步通知或重启补发的正式交接处登记明确接收者的归属，再发布文件引用；只交接符合现有产物规则的文件。AgentOutput 只查询接收者已持有的产物，不补办授权。物化、分支和导入也不借子会话归属修补遗漏的交接。用户专属后台任务不会变成模型文件资源。
- `Write`、`Edit`、`NotebookEdit`、`apply_patch` 遵守实际文件系统／执行边界，不增加保存路径特殊判断。POSIX 副本初始模式为只读，但这不等于 Full access 不能替换副本；不能靠某几个工具拒写来声称 OS 级只读隔离。
- 这不是新的 OS 多租户文件系统。普通文件访问仍遵循原有 Host/sandbox 权限；尤其 Full access 不是 Session 文件隔离。删除归属阻止后续资源服务访问，但不能撤回已经读出的字节、用户复制的文件或已打开的文件描述符。Session 清理会删除该 Session 的执行缓存。

## 对话依赖

所有结构化文件引用由统一的资源依赖收集器枚举。覆盖附件、保存输出、交付、子 Agent 结果及已脱离子 Session 的快照。复制不依赖生产 turn 恰好属于父对话。

引用分为不可变文件 ref 和后台任务输出 ref。不得从自然语言扫描绝对路径来恢复资源依赖。MCP 等只有文本展示的结果也必须显式记录其保存文件依赖。

## 后台输出

任务输出 ref 指向当前 Session 内的活日志，不是不可变文件。控制任务仍使用任务 ID/ref；模型通过当前输出文件路径读取日志。实际运行日志保留为 Host 私有状态，已暴露的执行副本在每次日志镜像完成后刷新；消费者重新打开路径即可读到新内容。批量完成通知的每个结构化输出都是依赖，不只收集 origin 中的第一个任务。

分支冻结的是创建分支时可取得的日志快照，不是假装恢复所选历史 turn 当时的日志。目标 Session 持有快照 Artifact，并将任务输出 ref 绑定到该快照；再次分支复制同一快照，不重新读取原任务。未取得的输出记录为不可用，禁止回退读取其他 Session 的运行文件。

导入可以移动 Host 的运行状态定位，但不得重写历史调用、回执或摘要。不可变文件引用及冻结任务输出的引用保持不变。

## 访问与性能

Read/Grep 与普通程序都读取执行路径实际指向的文件，不得到 Blob 物理路径。资源管理层准备执行副本时保护源文件生命周期、拒绝符号链接重定向，并限制缓存规模；文件工具不调用资源读取／搜索代理。

分页使用 `file_path`、`offset`、`limit`；不接受 ref，也不把空字段转换为兼容调用。资源物化时根据 MIME 选择可用的文件扩展名，随后交给普通文件读取器处理；SVG 是文本，不发送到不支持 SVG 的模型图片接口。

资源准备使用不附带 UI 列表 revision 的 `(session_id, artifact_id)` 索引查询；恢复枚举使用 keyset 分页，不为每个文件或每一页重新散列整个会话的归属，也不加载整个工作区的 Artifact JSON。资源描述只在资源表保存一次，Session 表只保存归属。SendUserFile 从实际路径捕获文件字节，发布后按内容去重；不能根据路径复用一份模型没有实际交付的资源内容。

执行缓存的缺失、普通文件系统错误或不安全目标按文件降级：不发布失败文件的路径、不跟随链接、不阻断其他文件与本轮请求。恢复只枚举一次，在后续请求重试未完成的文件；数据库、源 Blob 完整性错误仍显式上抛。

用户删除资源与再次交付发生竞争时，来源不存在／不可访问是工具业务失败，不触发 Host shutdown；真正的存储或回滚失败仍进入 Host drain。执行文件视图不进入导出包，导入只依赖资源身份及字节，在新 Host 上按需重建路径。

## 存储格式与协议

- Artifact schema 为 **7**；旧格式（包括缺少交接完成记录的开发版 schema 6）明确拒绝打开，不自动迁移或删除用户数据。不能从当前归属反推历史交接与删除顺序。
- `artifact_objects` 保存一次不可变资源描述；`artifact_records` 只保存 Session 归属。
- `session_task_output_snapshots` 保存分支的任务输出快照绑定；`null` 是不可用标记，不能被后来的活任务覆盖。
- `artifact_gc_paths` 保存未发布内容及无归属 Blob 的回收意图。
- `artifact_handoffs` 保存已完成交接的 `(session_id, source_session_id, artifact_id)`；没有指向 membership 或源 Session 的级联删除，也不持有 Blob。
- Host compatibility epoch 为 **176**，拒绝混用不认识新资源／文件目录接口的客户端。
- `session_file` 引用中的 `relativePath` 字段承载稳定 Artifact ID，不是文件系统路径。`maka://runtime/attachments/<id>` 是内部资源入口，模型通常获得当前执行视图的实际路径。

## 必须验证的性质

- 任意多次分支保留相同 ID 与可读取内容，包括子 Agent 快照及 MCP 长输出。
- 删除源 Session 并执行 GC 不影响其他 Session。
- 不持有归属的 Session 不能通过资源服务获得新执行视图；普通文件工具的访问由同一个执行环境权限决定，不假称 Full access 下的 Session 文件隔离。
- 活日志在源 Session 继续变化，分支快照不变化；再次分支仍读取同一快照。
- 导出导入、导入失败重试、批量发布失败与进程崩溃不产生半批可见资源或误删共享内容。
- 增加不相关 Session 的资源，不增加单文件读取需要解析的元数据量。
- 普通进程能够直接打开展示的路径；修改执行副本不能改变共享 Blob；缓存重建、分支和真实归档导入都产生可用文件。
- 真实子 Agent 完成链路同时返回交付文件与保存的长输出，不因测试绕过生产过滤而漏依赖。
- 外部执行器及禁止读取视图的 sandbox 不会收到冒充可用的 Host 路径。

人工验收步骤见 [文件资源与执行路径验收](../testing/file-resources-manual-qa.zh-CN.md)。
