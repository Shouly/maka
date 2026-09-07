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
 * 删掉 <br> 后面紧跟的 "\n" 文本节点。
 *
 * mdast-util-to-hast(react-markdown 内部)把 markdown 硬换行(行尾 `\`
 * 或两个空格 —— TipTap 输入框的 Shift+Enter 就序列化成 `\` + 换行)转成
 * `<br>` 加一个 `"\n"` 文本节点,后者只为 HTML 源码美观。普通 white-space
 * 下它会被折叠;但用户消息的 <p> 用 whitespace-pre-wrap 渲染(为保留软换行
 * 和连续空格),这个 "\n" 就成了第二个换行 → 用户输入的每个换行翻倍成空行。
 *
 * 应用场景(所有渲染用户输入且 p 带 pre-wrap 的 ReactMarkdown):
 *   - 主 chat UserMessage / 分享页用户气泡
 *   - 共享 ui/Markdown(群聊 message-item 外层 [&_p]:whitespace-pre-wrap)
 *
 * 顺序:在带 rehypeRaw 的管线里排在它【之前】。raw 节点对本插件不透明,
 * 所以作者手写 HTML(字面 <br>、<pre> 内容)里的真实换行不会被误删;本插件
 * 只清理 markdown 硬换行产生的合成 `<br>`+"\n" 对(该组合总在同一父节点内、
 * "\n" 为独立文本节点)。代价:字面 `<br>` 行尾的换行在 pre-wrap 下仍显示
 * 两个换行 —— 这是 pre-wrap 对源文本的忠实语义,属接受的边缘残留。
 */

import type { HastNode } from './hast-node'

export function rehypeStripBreakNewlines() {
  return (tree: HastNode) => strip(tree)
}

function strip(node: HastNode): void {
  const children = node.children
  if (!children) return
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]
    if (child.type === 'text' && i > 0 && child.value?.startsWith('\n')) {
      const prev = children[i - 1]
      if (prev.type === 'element' && prev.tagName === 'br') {
        // 防御分支:若上游插件把 "\n" 与后续文本合并过,只剥第一个换行。
        // 当前管线(插件在 rehypeRaw 之前)里 "\n" 恒为独立节点。
        if (child.value === '\n') children.splice(i, 1)
        else child.value = child.value.slice(1)
        continue
      }
    }
    strip(child)
  }
}
