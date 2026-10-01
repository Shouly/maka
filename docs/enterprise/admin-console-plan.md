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

# 管理后台（阶段 1）实现方案

2026-09-29。依据是 `server-platform-design.md` 的 D5 和 §3.2：服务端自带的网页管理后台，和 API 同一个服务、同一个镜像；只有组织管理员能进；登录方式和员工一样，用浏览器会话 cookie（HttpOnly、SameSite、CSRF 防护），不用桌面端的令牌；前端用 React 和 Maka 相同的设计系统，是 `apps/server` 里的单页应用，由服务端直接托管。

阶段 1 的页面：用户、模型提供商与模型、额度、用量报表、审计日志、设备会话。命令行 `admin.js` 保留，作为没有浏览器时的兜底。

## 1. 登录与会话

- **入口**：`GET /admin/login`，和桌面端登录相同的页面，每个身份源一个按钮。登录没成功时回到这里，并说明原因。
- **复用桌面端的登录事务**：`login_transactions` 里 `client_id` 记为 `maka-admin-console`，`redirect_uri` 记为 `/admin/`。身份源回调仍是已经登记的那个地址（`/login/<provider>/callback`），回调里按 `client_id` 分流：桌面端发授权码，管理后台建网页会话。这样不需要在身份源那边再登记一个回调地址。
  - 桌面端靠 PKCE 把登录绑在发起它的应用上；管理后台没有 PKCE，改用一个只发往回调地址、10 分钟有效的 cookie 把登录绑在发起它的浏览器上，事务里只存它的哈希。回调链接在别的浏览器里打开，登录不会成功。
  - 登录后回到的地址（`next`）按浏览器的方式解析（`..`、反斜杠、编码），只接受 `/admin/` 下、不是接口也不是登录页的地址。
- **只有组织管理员能进**：回调里账号不是 `org_admin`，或已停用，显示“只有组织管理员能进入管理后台”，并记审计 `admin.signin_refused`。
- **网页会话**：新表 `admin_sessions`（迁移 0005），存 cookie 令牌的哈希、用户、CSRF 令牌、登录时间、最后使用时间、过期时间（登录后 12 小时）、吊销时间、IP、User-Agent。
  - 每个请求都重新核对用户仍是启用状态的管理员。被降级或停用的人立刻进不来，不等会话过期。
- **cookie**：名为 `maka_admin`，`HttpOnly`、`SameSite=Lax`、`Path=/admin`，服务器地址是 https 时加 `Secure`。
  - 用 Lax 而不用 Strict：从身份源跳回来的那次跳转是跨站导航，Strict 会让第一次打开 `/admin/` 时带不上刚写下的 cookie。
- **CSRF**：
  - 改数据的请求（POST/PUT/PATCH/DELETE）必须带 `x-maka-csrf` 头，值和会话里的一致；`Origin` 头存在时必须是本服务器；请求体只收 JSON。
  - 只读请求都是 GET，Lax 的 cookie 本来就只随 GET 跨站。
- **退出**：`POST /admin/api/session/sign-out` 吊销会话、清 cookie。
- **清理**：过期超过一天的网页会话由现有的定时清理一并删除。

## 2. 接口（`/admin/api`，全部要求管理员会话）

每个写操作都写审计：`actorUserId` 是管理员，`detail.via` 是 `admin-console`，带 IP。

| 资源 | 接口 | 说明 |
|---|---|---|
| 会话 | `GET /session`、`POST /session/sign-out` | 当前管理员、CSRF 令牌、服务器地址 |
| 成员 | `GET /users?query=` | 列表：姓名、邮箱、角色、状态、最近登录、在用设备数 |
| | `GET /users/:id` | 详情：身份源绑定、设备会话、个人额度、本期用量 |
| | `PATCH /users/:id` | 改角色、停用/启用。停用时吊销全部设备会话和网页会话。不能停用或降级自己，也不能动最后一个管理员 |
| | `DELETE /users/:id/links/:provider` | 解除身份源绑定，并吊销通过该身份源登录的设备和管理后台会话 |
| | `POST /users/:id/devices/:deviceId/revoke` | 让某台设备退出登录 |
| 模型提供商、模型 | `/model-providers…`、`/models…` | 见 [模型接入与网关设计](model-gateway-refactor-design.md) §8 |
| 额度 | `GET /quotas`、`PUT /quotas/default/:period`、`PUT /quotas/users/:userId/:period` | 周额度、月额度；`limit: null` 表示去掉（组织默认即不限制，个人即回到默认） |
| 用量 | `GET /usage?days=` | 合计、按人、按模型；失败只算出错的请求，用户自己停止的不算。成员本期额度的使用情况在成员详情里 |
| 审计 | `GET /audit?before=&action=` | 按时间倒序分页，每页 100 条；成员、模型提供商、模型、设备、个人额度的对象带上可读名称 |

模型提供商与模型的接口、数据和网关见 [模型接入与网关设计](model-gateway-refactor-design.md)。

## 3. 前端

- **位置**：源码在 `apps/server/console/`，Vite 构建到 `apps/server/dist/console/`，服务端在 `/admin/` 下托管：资源文件长缓存，页面本身 no-store，并加严格的 CSP。
- **设计系统**：直接复用桌面端的样式 token、字体和基础组件（按钮、输入框、下拉、开关、对话框、菜单、提示，以及设置页的 `SettingsSection` / `SettingsRow` / `SettingsTable`），通过构建别名引用 `apps/desktop/src/renderer`，不复制。以后要单独发包时，再把这些抽成独立的包。
- **布局**：和 Maka 设置页相同，左侧导航、右侧内容，内容是分区加纯文字行和表格，详情页替换内容区、顶部带返回。
- **导航**：
  - 组织：成员、额度；
  - 模型：模型提供商（英文 LLM Provider）、模型。先有提供商，模型才能从它开放，所以提供商在前；
  - 记录：用量、审计日志。
  - 左下角是当前管理员和“退出登录”。
- **语言**：跟随浏览器，中文或英文，和登录页一致。
- **写操作**：和设置页一样即时生效、失败才提示；危险操作（停用成员、删除模型提供商或模型、让设备退出）先确认。

模型提供商和模型的页面流程见 [模型接入与网关设计](model-gateway-refactor-design.md) §2。

## 4. 测试

- **服务端**（PGlite，沿用 `__tests__/support.ts`）：
  - 管理员登录的完整流程；非管理员被拒；cookie 和 CSRF 校验（缺头、错头、跨站 Origin）；会话过期；降级后立刻失效。
  - 每个接口的正常路径和拒绝路径，以及审计记录。
- **前端**：构建通过；用一个带示例数据的本地测试服务器，逐页截图检查。

## 5. 实现状态（2026-09-29）

- 服务端：`src/administration.ts` 是全部管理操作，管理后台接口和命令行 `admin.js` 共用，规则只写一处（不能动自己的权限、至少留一个管理员、停用即全部退出登录）。`src/admin-console/` 是登录、会话、接口和页面托管；迁移 0005 建 `admin_sessions`。
- 前端：`apps/server/console/`，构建进 `dist/console`，`npm --workspace @maka/server run build` 一并构建。桌面端的组件通过 `@desktop/*` 别名直接引用，`@maka/ui` 只取语言上下文。
- 测试：管理后台 15 个（登录与浏览器绑定、返回地址、会话、CSRF 与只收 JSON、每次请求复核管理员身份、解除绑定、每类接口、页面托管）；前端用示例数据在真实浏览器里走过设置额度、停用成员等写操作。模型提供商与网关的测试见网关设计 §9。
- 并发：改角色和状态、写同一个额度，各自用事务级 advisory lock 排队；名字或 id 被并发抢先时回 409 而不是 500。
- 部署（M5 要处理）：前端构建直接引用 `apps/desktop/src/renderer`、`apps/desktop/assets`、`packages/ui/src`，还需要已构建的 `@maka/core`，所以镜像要在整个 monorepo 里构建，不能只拷 `apps/server`。
- 本地第一次进入：用命令行把自己设为管理员（`node dist/admin.js users role <email> org_admin`），或在部署配置里写 `MAKA_BOOTSTRAP_ADMIN_EMAILS`。

## 6. 不在这一版

- 组织策略、技能与插件目录（阶段 2）。
- 用量图表：第一版只有表格。
