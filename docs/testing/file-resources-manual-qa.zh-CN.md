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

# 文件资源与执行路径验收

设计说明：[不可变文件资源](../architecture/immutable-file-resources.zh-CN.md)。

本清单是人工验收标准，不把自动化通过视为所有平台和 UI 流程均已通过。不得为此新增模型工具或压缩后的文件清单。

## 安全前提

- 使用独立、可丢弃的资料目录及项目目录。不要删除、迁移或覆盖个人资料目录来绕过格式错误。
- `stateRoot` 与项目 `cwd` 是两个概念；新建聊天或切换项目不能改变资料库格式。
- 本次 Artifact schema 是 **7**，Host compatibility epoch 是 **176**。旧格式（包括开发版 schema 6）应报错并保持原数据不变，不应自动“修复”为一个空资料库。不要直接用新代码重启已有 schema 6 的 QA 目录。
- Windows、真实远程 Host 和桌面 UI 项目需要在对应环境实际执行；不能把 macOS 上的单元测试当作这些环境的验收结果。

## 1. 附件不是伪路径

1. 上传一个带中文、空格文件名的 JSON，以及 PNG、SVG、PDF 各一个。
2. 要求模型使用 `Read(file_path)` 读取 JSON 的指定行，再用 Bash/Python 解析同一个路径。
3. 检查模型实际收到的请求：首选入口是 `file-views` 中的绝对文件路径，而不是 Blob 路径或 `maka://` 文件 URI。
4. 用普通进程验证路径确实存在，不能只看 Read 是否成功。
5. PNG 可以作为图片读取；SVG 作为文本读取，不发生 `projection_failed`。PDF 可以交给执行环境中已有的转换程序；Read 不应假装支持 PDF 解码。
6. 对不支持视觉的模型，附件路径仍然可用，不要求先把文件转换成图片消息。

## 2. 长输出与文件工具组合

1. 运行一个输出超过展示阈值的 Bash 命令，以及一个返回长文本的 MCP 工具。
2. 确认展示是预览，完整保存输出有真实路径；用 Read 分页、Grep 搜索末尾内容、Bash/Python 打开该文件。
3. 确认持久结果仍保留 `savedOutput.ref` / `fileRefs`，而不是拿绝对路径充当身份。
4. 对该路径使用 `SendUserFile`：应捕获该路径当前实际字节，不能根据路径换成另一份资源内容；存储层仍按内容去重。
5. Write/Edit/NotebookEdit/apply_patch 的权限应与实际执行环境一致，不依靠保存路径特判。需要保留修改时应先复制到工作目录。
6. 在测试用 Full access 环境故意修改执行副本，再重新请求路径：资源原始字节必须不变，副本可以重建。不要在真实用户资料库做此测试。

## 3. 多次分支及源会话删除

1. 在 A 中上传附件、产生长输出、交付文件，再从 A 分支得到 B，从 B 分支得到 C。
2. 在每个会话中查询同一资源：Artifact ID 保持一致；模型获得所属执行视图中的当前路径。
3. 删除 A/B 并执行正常清理后，C 的文件仍可读、搜索及再次交付。
4. 不相关会话猜测资源 ID 不能获得新的物化授权；Full access 能否读取现有路径由普通文件系统权限决定，不能宣称资源归属等于 OS 隔离。
5. 同一个旧路径在 Read、Grep、Bash、Python 中必须指向相同内容。失效后均应失败，不得静默绑定当前分支快照。系统应提供新的文件信息，不新增发现工具。
6. 删除归属后，资源管理层不得继续物化。文件工具不反查归属：实际文件若已清理则失败，已复制的字节及已打开的 fd 无法撤回。
7. 在另一个会话运行时切入 C，再切回；重复查询 C 的后台任务列表与单项状态。已删除的来源应显示为 `source_unavailable`，不能触发 Host drain、打断其他回合或恢复来源会话。运行中不能因切换而变成已完成；模型列表读取中／失败与真正空列表应区分。重启后重复查询仍应正常。
8. 分别按 A→B→C 和 B→A→C 的顺序删除，包含 C 完成新回合并重启 Host 后再删除的情形。来源不可用的历史 `running` 不得阻止空闲分支归档或删除，也不得被改写为 `completed`；若分支另有真正活跃的 Runtime Resource，则仍应拒绝归档和删除，停止该资源后才可继续。

## 4. 子 Agent 的真实完成链路

1. 让子 Agent 实际执行 `SendUserFile`，并产生一次足够长、需要保存的工具输出。
2. 查看父 Agent 接收到的完成结果／通知，确认两类 Artifact 都在结构化依赖中。
3. 正式交接先登记父会话归属，再提供父会话的实际路径；物化不得根据父子关系补授权，也不得交接私有上传。
4. 从父会话创建脱离子会话的快照分支；删除原子会话及源会话后，文件仍可消费。
5. 同时覆盖同步结果、异步完成通知和重启补发，不使用手工构造 `artifactIds` 的测试替代真实完成过滤链路。交接失败不得发布未持有的文件；AgentOutput 查询不能补授权。

6. 父会话完成交接后删除交付文件，在通知未消费时恢复 Host，以及在通知已消费后重试同一 Graph 执行：两种情况都不得重新创建父归属。真正的新交付或其他接收者不受影响；导出导入后仍应保持这项语义。

## 5. 活日志与冻结快照

1. 启动一个持续输出的后台任务，取其当前执行路径，多次重新打开文件验证内容持续更新。
2. 运行中创建分支 B；B 看到的是分支时的快照。源日志继续变化时，B 不变。
3. 从 B 再分支 C，删除源运行状态及 B：C 仍是同一份冻结内容，不重新连回原任务。
4. 对实际路径执行 `Read({file_path, offset: 2, limit: 1})`，核对同一路径的普通程序读取结果；Read 的 ref 参数应被拒绝。
5. 让两个后台任务同时完成，触发一次批量通知；两个输出都应在模型展示与复制依赖中。
6. 用户专属后台任务不应通过猜测 task-output ref 暴露给模型。

## 6. 重启、压缩历史与归档导入

1. 停止 Host，仅删除测试会话的 `file-views` 缓存，再启动并继续该会话；摘要原有路径应在执行前恢复，不追加文件列表。
2. 压缩历史后，直接继续使用摘要中的路径。文件、归属和路径不变，不新增文件发现、枚举或清单注入，也不改写摘要。
3. 导出实际 `.maka-session` 归档，导入另一个资料目录；条件允许时再导入另一台机器。
4. 确认归档没有打包 `file-views`；新 Host 按资源身份和字节重建文件，并在新环境首次执行的上下文说明迁入文件的新路径。再次执行不重复追加。
5. 删除源测试资料后，导入文件仍可读。历史调用、摘要和旧路径原文不应被全局字符串替换。
6. 导入项目工作目录的选择是独立事项；资源路径可恢复不表示原来的项目工作区也被复制。

## 7. 边界与竞态

- Managed 只读配置下，真实 shell 可读取保存路径，但没有得到额外写权限。
- 自定义 sandbox 禁止读取视图时，不应声称路径可用，更不能自动放宽权限。
- 远程 Host 的路径只供远程 Host 的执行工具使用；不能把它冒充为客户端浏览器可访问的本地路径。
- `external` 执行器没有自己的物化能力时明确不可用，不泄漏一个不可消费的 Host 本机路径。
- 在交付期间移除实际执行文件：交付应按文件系统结果成功捕获或失败，不能回退到 Blob 或另一会话快照；失败不能产生半批文件或导致 Host 退出。
- 在测试目录植入视图文件或目录符号链接：物化应拒绝，不修改链接目标。
- 将测试用单个执行副本替换为目录，再恢复会话：该文件明确不可用，其他文件可用，本轮仍能执行。修复这个缓存位置后，后续请求应能重试恢复；不能把数据库或 Blob 完整性错误也当成普通缓存失败吞掉。

## 自动化入口

先构建 Core、Storage、Runtime、Runtime Host，再运行重点集成用例：

```sh
node --test \
  packages/runtime/dist/__tests__/file-resource-projection.test.js \
  packages/runtime/dist/__tests__/file-path-tools.test.js \
  packages/runtime/dist/__tests__/resource-copy-closure.test.js \
  packages/runtime/dist/__tests__/session-import-resources.test.js \
  packages/runtime-host/dist/__tests__/file-resource-paths.test.js \
  packages/runtime-host/dist/__tests__/file-resource-service.test.js \
  packages/runtime-host/dist/__tests__/execution-artifacts.test.js
```

还应运行 `session-manager`、Bash/MCP 长输出、消息投影、ShellRun、会话分支／退休及 Artifact/归档存储相关回归。`file-resource-paths` 包含真实进程读取、macOS 沙箱、实际归档导入、修改副本后的重建和删除／交付竞争测试；它不替代上述平台及桌面人工检查。

## 路径改造阶段自动化记录（macOS，schema 6 历史快照）

以下是 schema 7 交接重放、恢复性能与失败隔离修复之前的历史结果，不代表这三项修复后的验收：

| 范围 | 通过 | 跳过 | 失败 |
| --- | ---: | ---: | ---: |
| Core + Storage | 2,022 | 8 | 0 |
| Runtime | 3,789 | 13 | 0 |
| Runtime Host | 1,969 | 12 | 0 |
| CLI | 1,056 | 3 | 0 |
| Desktop main | 1,756 | 0 | 0 |
| Desktop renderer state | 426 | 0 | 0 |
| 合计 | **11,018** | **36** | **0** |

Core、Storage、Runtime、Host 构建通过；Host 和 CLI 类型检查通过；Desktop preload/main/renderer 类型检查及 main 构建通过。实际归档测试验证了导入后的持久历史未变、新路径可读且归档不含执行缓存；图片观察使用 Artifact，旧图片读取适配入口已删除。子 Agent 通知与 AgentOutput 的模型展示不再夹带内部文件 ID，持久依赖不受影响。

并行运行期间曾有一次 Host 连接状态时序断言失败，保留于 `/tmp/maka-resource-host-parallel-failure.log`；未放宽断言，随后独立执行 Host 全套回归通过。最终日志为 `/tmp/maka-resource-final-{core-storage,runtime,host}-tests.log`、`/tmp/maka-resource-cli-tests.log` 和 `/tmp/maka-resource-desktop-tests.log`。

上述结果不表示 Windows、真实远程 Host 或桌面人工流程已验收。无物化 adapter 的 external 执行器仍明确不可用，不回退读取 Host 文件。

## 交接重放与恢复修复自动化记录（schema 7，2026-10-10）

- Storage、Runtime、Runtime Host 重新构建通过，构建新鲜度检查通过；全仓 typecheck 通过。
- 新鲜构建上串行执行全部 workspace 测试：**12,064 项，12,027 通过，37 跳过，0 失败**。
- 新增回归覆盖：交接完成后删除、存储重开、通知恢复、公开 Graph 重试入口、不同接收者及新交付、归属与完成记录的事务回滚、分支／归档携带完成记录、记录不阻止 Blob GC、schema 6 无损拒绝。
- 文件准备回归覆盖：目录／符号链接阻断单份视图但不阻断请求、不修改链接目标、仅重试失败项、磁盘空间不足与真正 I/O 错误的区分、异常 Blob 不被当作缓存错误吞掉。
- 恢复性能回归用 450 个资源（含任务输出快照）验证 keyset 分页与单点查询，不按文件重复枚举归属或快照。独立 1,000 资源复现中，membership revision 扫描为 0，资源描述读取为 3,000 条；这是查询量验证，不是生产性能指标。
- 日志：`/tmp/maka-fix-r4-all-tests.log`、`/tmp/maka-fix-r4-typecheck-final.log`、`/tmp/maka-fix-r4-repro.log`、`/tmp/maka-fix-r4-restoration-cost.log`。

此次没有重启桌面 App，也没有迁移、清理或改动已有 QA 资料目录。Windows、真实远程 Host 和新版桌面模型流程仍待对应环境验收。

## 桌面发现的来源删除／切换故障及修复（schema 7，2026-10-12）

真实 Dev App 的 A→B→C 测试中，删除 A/B 后 C 的文件仍能冷物化和读取，但后台任务状态查询沿历史 lineage 读取已删除的 B。`session_not_found` 未被识别为正常缺失，最终误触发整个 Host drain；当时的 C 回合实际为 `aborted`，不能按正常完成计入验收。

本次局部修复不改 schema、不迁移或重置资料库：

- Runtime 先确认祖先会话仍存在，再读取可能缓存的 shell 记录；缺失祖先返回 `source_unavailable`，保留历史结果，不伪造任务已完成。只在这个可选祖先边界识别缺失，当前会话缺失与真实数据库／I/O 错误仍向上报告。
- Desktop 区分模型列表加载中、读取失败和成功读取的空列表，失败时提供重试；环境状态读取失败不再冒充 Host 明确拒绝新任务。
- 新增真实 SQLite 回归覆盖普通分支／revision、祖先删除、缓存残留、列表／点查和错误传播；Host UDS 回归使用真实复制的 ledger，覆盖删除 A/B、其他会话运行不受影响、C 继续新回合以及进程重启。Renderer 回归覆盖切换／断连不制造完成事实，已持久化的中断仍为中断。

### 自动化结果

全仓构建、typecheck、构建新鲜度及差异检查通过。新鲜构建全仓测试：**12,071 项，12,034 通过，37 跳过，0 失败**；其中 renderer state **429/429**。日志位于 `/tmp/maka-fix-app-switch-{build,all-tests,typecheck-final}.log`，修前复现位于 `/tmp/maka-fix-app-switch-before-host-tests.log`。

### 原故障现场的真实 App 回归

保留原 schema 7 数据，直接重新打开 QA7-C（`3c794aee-c9ca-481f-87e7-a7945db9c905`），没有清库、重建 A/B 或重写旧回合。使用真实 GPT-6 Astra / Medium / Manual：

- 新回合 `a4933b5b-55de-4226-8925-fb70250d444e` 中实际执行 Read 和 Bash/Python；Python 等待 **35.002 秒**，期间四次切走再切回（含离开 5 秒的一次）。每次返回仍显示运行中、Stop 可用、模型仍为 GPT-6 Astra，无环境阻断或 Host 重启；该新回合最终持久化为 `completed`。
- Read 后再由 Python 重新打开 C 的真实路径，确认 report 是 v1、JSON 有 1,000 项、alpha 为首份冻结快照的 60 行；快照字节与修复前一致。Read 的 `totalLines` 会计入末尾空行，与 Python `splitlines()` 的计数口径不同。
- 对旧 A 路径分别真实调用 Read、Grep、Python open、SendUserFile，均明确失败，没有偷偷映射为 C。
- 对当前 C 的 report v1 再次 SendUserFile 成功，保存字节为原 40 字节；新交付身份与原资源不同，共享同一 Blob。
- 只读核验：A/B/两个 child 仍已删除，C 原有 20 份归属全部保留（新交付后为 21），用户原会话事件及 Artifact 归属未变，数据库 `quick_check=ok`。
- 验证后已正常无调试参数重启 Dev App；9334 无监听，发布的 Dev 启动参数也不再含远程调试选项。

证据目录：`/tmp/maka-app-qa-20261012-040400/switch-fix/`，含真实输入、切换状态、工具结果摘要、只读核验和截图；旧故障日志及私有数据库快照保留在原 QA 目录，未覆盖。企业目录同步另受本机 `localhost:3000` 的 IPv4／IPv6 两个不同服务影响：IPv4 企业网关健康，IPv6 命中另一个 Next.js 服务；未擅自停该服务或修改连接配置，不能将本轮模型执行成功当作企业目录同步健康的证明。

上述是该阻断点的回归通过，不是整份清单全通过。桌面坏缓存／修复重试、压缩、导出导入、长 MCP 输出等后续流程仍须继续；当前模型没有暴露同步 Agent／AgentOutput，Windows 与真实远程 Host 也仍未验收。

## 来源不可用的历史任务阻止退休：修复与自动化回归（schema 7，2026-10-12）

后续评审确认：来源删除后正确返回的 `source_unavailable` 仍保留历史 `running`，但 Host 的 `hasLiveSessionResources()` 只检查状态，将空闲分支误判为忙碌，阻止删除和归档。此前切换回归只按 B→A 删除，没有最后删除 C，也没有覆盖 A→B 的删除顺序。

本次只在活跃资源判断中排除 `source_unavailable`，不改写历史状态、不隐藏查询结果、不重建来源、不放宽数据库／I/O 错误处理。`local` 和可解析的 `source_owned` 活跃资源仍算忙碌。

- 新增单元回归覆盖 `starting`／`running` 的不可用历史、与真正活跃资源混合、保留查询结果以及读取错误原样传播。
- 新增真实 Host 进程／UDS 回归覆盖 A→B 和 B→A 两种删除顺序、C 新回合完成及冷重启后删除 C；另用真实 `sleep` 进程验证活跃时仍拒绝删除／归档，停止后可归档和删除，历史 `running` 不变。
- 先加入回归、保留旧判断时出现 **5 项预期失败**；修复后相关 **65/65 通过**。完整构建、全仓 typecheck、构建新鲜度、相关文件 Biome、ASF headers 和差异检查通过。
- 本轮全仓执行 **12,077 项，12,039 通过，37 跳过，1 失败**；唯一失败是 `workspace-identity` 测试清理临时 `.git/hooks` 时的 `ENOTEMPTY`。保留原日志，不修改该测试或放宽断言；该测试文件随后 **13/13 通过**，Storage 整套复跑 **1,192 项，1,184 通过，8 跳过，0 失败**。不能把复跑结果写成首次全仓零失败。
- 证据目录：`/tmp/maka-fix-retirement-20261012-064017/`，含 `tests-before-fix.log`、`tests-after-fix.log`、`all-tests.log`、`workspace-identity-rerun.log`、`storage-rerun.log`。

这些是独立临时资料库上的自动化集成验证，模型执行使用测试 backend，不是新的真实模型或桌面 UI 验收。本次未操作现有 Dev 会话、未清库或修改用户数据；整份人工清单仍未全部验收。
