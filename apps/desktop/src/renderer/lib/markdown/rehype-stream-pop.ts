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
 * 流式"尾部渐显"入场(claude.ai cowork 式):把文本节点切成 token 级
 * <span class="stream-pop">,配合 globals.css 的入场动画使用。
 *
 * 原理:CSS animation 只在元素**新挂载**时播放。流式文本 append-only,
 * React 按位置复用已渲染 token 的 DOM(不重放动画),每次刷新只有新到的
 * token 产生新 span 开始渐入,旧内容纹丝不动。上层配合 StreamPopMarkdown
 * 的 ~180ms 攒批 + 0.8s 淡入,尾部几批文字同时处于不同透明度 → 最新文字
 * 呈淡淡浮现、逐渐凝实的渐隐尾迹,而非逐字打字机。
 *
 * 切分规则(与 smooth-stream-transformer 的中英混排分块同思路):
 *   - 无空格文字(中文、日文假名、谚文):单字一个 span —— 这类文字没有
 *     空格,若按"连续段"切,尾部 token 会原地长大(DOM 复用 → 不播动画),
 *     新文字就永远不会渐显
 *   - 空白:保留为纯文本节点(不包 span),维持正常折行/空格折叠
 *   - 其余(拉丁词、数字、标点连续段):整段一个 span,词边界天然由
 *     空格闭合,只有边界词会静默长大(攒批节奏下不可感)
 *
 * 跳过子树:code/pre(Markdown.tsx 的 code 组件用 String(children) 取源码,
 * 混入 span 会得到 "[object Object]")、KaTeX 输出(结构敏感)、svg 等。
 *
 * 顺序:排在 rehype 管线【最后】(rehypeKatex 之后),只处理最终要成为
 * 可见文本的节点。仅流式草稿期启用;定稿渲染不加此插件,产物零 span。
 */

import type { HastNode } from './hast-node';

const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style', 'svg', 'math', 'textarea', 'title']);

// 按单字切的“无空格文字”区段:日文假名(3040-30FF)、CJK 统一表意含 Ext-A
// (3400-9FFF)、谚文音节(AC00-D7AF)、CJK 兼容表意(F900-FAFF)。
// 单字 | 空白段 | 其余连续段
const CJK_LIKE = '\\u3040-\\u30FF\\u3400-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF';
const TOKEN_REGEX = new RegExp(`([${CJK_LIKE}])|(\\s+)|([^\\s${CJK_LIKE}]+)`, 'g');

function isKatexElement(node: HastNode): boolean {
  const cls = node.properties?.className;
  if (Array.isArray(cls)) return cls.some((c) => typeof c === 'string' && c.startsWith('katex'));
  return typeof cls === 'string' && cls.includes('katex');
}

function tokenSpan(token: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['stream-pop'] },
    children: [{ type: 'text', value: token }],
  };
}

function splitTextInto(value: string, out: HastNode[]): void {
  TOKEN_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = TOKEN_REGEX.exec(value)) !== null) {
    matched = true;
    // 空白保持纯文本;其余 token 包 span
    out.push(m[2] !== undefined ? { type: 'text', value: m[0] } : tokenSpan(m[0]));
  }
  // 防御:三个分支已覆盖任意字符,理论到不了;万一正则改挂了保住原文
  if (!matched) out.push({ type: 'text', value });
}

// 重建子数组而非 splice+spread:超长文本节点(数万 token)展开成实参会撞
// 引擎参数上限,倒序 splice 也是 O(n²);逐个 push 两者皆免
function walk(node: HastNode): void {
  const children = node.children;
  if (!children) return;
  let out: HastNode[] | null = null;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // 纯空白节点原样保留,省一次无意义替换
    if (child.type === 'text' && child.value && child.value.trim() !== '') {
      if (!out) out = children.slice(0, i);
      splitTextInto(child.value, out);
      continue;
    }
    if (child.type === 'element' && !SKIP_TAGS.has(child.tagName || '') && !isKatexElement(child)) {
      walk(child);
    }
    if (out) out.push(child);
  }
  if (out) node.children = out;
}

export function rehypeStreamPop() {
  return (tree: HastNode) => walk(tree);
}
