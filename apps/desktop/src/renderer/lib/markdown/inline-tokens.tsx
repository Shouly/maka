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
 * 用户消息里的 inline token 渲染:把字符串里的 @kebab-name 和 /kebab-name
 * 切成 styled span。
 *
 * 应用场景:
 *   - 主 chat UserMessage(react-markdown) — p / li 的 children 里
 *   - 群聊 message-item(共享 Markdown 组件) — 同上
 *
 * 用户消息发出去后,@agent / /skill 已被 TipTap 序列化成纯文本(markdown),
 * react-markdown 渲染时当普通文字。这里加一遍 regex pass 还原成视觉胶囊,
 * 跟编辑器里输入时的样子对齐。
 *
 * Lookbehind `(?<![\w/])`: 排除前置 word char 或 /,防止误识别:
 *   - 邮箱 user@example.com 里的 @example
 *   - 文件路径 /usr/local/bin 里的 /usr 等
 *   - URL https://x.com/path 里的 /path
 *   - kebab 名字 a-b/c 里的 /c
 *
 * 名字允许一个可选的 `:kebab` 子段,匹配 plugin skill 的 qualified name
 * (/plugin-name:skill-name)。子段必须以字母开头,所以普通冒号(/skill: 说明)、
 * 端口(@host:8080)、时间(12:30)不受影响。
 */

import React, { Children } from 'react';

const TOKEN_REGEX = /(?<![\w/])([@/])([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?)/g;

/** 单一样式:仅 text-accent 文字色。字号/字重沿用所在段落,不强加。 */
const TOKEN_CLASS = 'text-accent';

/** 按名单认出来的 @真人:accent 淡底的小胶囊,和 Y 状态芯片同一档色 */
const NAMED_MENTION_CLASS = 'rounded-[4px] bg-accent-subtle px-1 py-px text-accent';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 频道消息里 @ 的是真人,名字不是 kebab(中文、大写、空格都有),靠消息自带的 mentions 名单认:
 * 名字最长优先拼进同一条正则,所以「张三」「张三丰」同在时 @张三丰 不会被拆开。
 */
function tokenRegex(names?: string[]): RegExp {
  if (!names || names.length === 0) return TOKEN_REGEX;
  const alt = [...new Set(names)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`(?<![\\w/])([@/])([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?)|(@(?:${alt}))`, 'g');
}

/** 把一段纯字符串切成 [text...span...text] 节点数组;无匹配则返回单元素数组。 */
export function renderInlineTokens(text: string, names?: string[]): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  const re = tokenRegex(names);
  re.lastIndex = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const [whole, , , named] = match;
    parts.push(
      <span key={`tok-${key++}`} className={named ? NAMED_MENTION_CLASS : TOKEN_CLASS}>
        {whole}
      </span>,
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/** 对 React children 做一遍 inline token replacement,只换 string,
 *  React 元素(链接/粗体等其他 markdown 节点)原样保留。 */
export function processTokenChildren(children: React.ReactNode, names?: string[]): React.ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderInlineTokens(child, names);
    }
    return child;
  });
}
