/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Search highlight rendering — 受控的 <mark> 标签 sanitize
 *
 * 后端搜索接口返回的 title_highlighted / content_highlighted 是
 * "用户原文 + <mark>...</mark>" 格式 (主路径来自 OpenSearch highlight,
 * 降级路径来自 SQL substring 拼接, 两者契约一致, 均未做 HTML escape)。
 *
 * 安全策略 — 两步走:
 * 1. 全量 escape 所有 HTML 特殊字符 (& < > " ')
 *    → <script>alert(1)</script> 变 &lt;script&gt;alert(1)&lt;/script&gt;
 * 2. 只反转受控的 <mark> 标签 (从 escape 后的 &lt;mark&gt; 还原回 <mark>)
 *    → 这是唯一允许进 DOM 的标签
 *
 * 不用占位符方案的原因: 占位符字符串理论上可能跟用户原话冲突。
 * "先 escape 后反转 escape 序列" 不依赖任何不存在于用户原文的字符串。
 *
 * 唯一允许的标签是 <mark>: 语义清晰, 无脚本执行能力。
 */

/** 把后端返回的高亮 HTML sanitize 成安全可渲染的字符串 */
export function sanitizeHighlight(input: string | null | undefined): string {
  if (!input) return ""
  // 1. 全量 escape: 任何 HTML 特殊字符都被 escape, 一切标签变文本
  const escaped = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
  // 2. 只把 escape 后的 <mark> / </mark> 反转回真标签
  return escaped
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>")
}
