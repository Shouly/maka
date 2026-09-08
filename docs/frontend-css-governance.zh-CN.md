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

# 企业版前端 CSS 约定

当前设计以 [globals.css](../apps/desktop/src/renderer/styles/globals.css) 和
`components/ui/` 为准。旧 Astryx 契约、文字仅两档规则及 Storybook 流程已退出本分支。

- 组件使用语义颜色；新增颜色放入 token 文件。架构检查禁止组件中的任意色值。
- 菜单、对话框和输入控件复用现有 Radix 基元。布局由所属组件管理，共享行为和原生窗口适配才进入全局 CSS。
- 同时验证亮色、暗色和减少动态效果模式。图标按钮必须有本地化名称和可见的键盘焦点。
- 保留标题栏拖拽边界、模态层级、内嵌浏览器隐藏规则和有界历史的滚动控制。长列表避免 `transition-all`。
- 新渲染层已纳入 Biome。提交前运行格式、lint、架构、多语言检查以及 `git diff --check`。
- 状态判断放入 renderer state 测试；跨 IPC、重启持久化、原生输入和终端生命周期放入有预算的 Electron E2E。
- 涉及视觉变化时附受影响页面的亮暗截图及测试结果。E2E 的 AX 检查核验可操作控件的可访问名称。

架构清单和第三方许可证由脚本生成。原生覆盖层和浏览器对话框仍使用部分旧样式资源，不能因为 React 未引用就删除。

范围与未完成验收分别见[重写计划](enterprise/frontend-rewrite-plan.md)和[发布清单](enterprise/release-checklist.md)。
