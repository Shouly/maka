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
 * 裸 `$x$` 行内公式:自己在 mdast 上切,不开 remark-math 的
 * singleDollarTextMath —— 那个没有启发式,"It costs $100 and $200" 会被切出
 * 一个内容为 "100 and " 的公式,而 claude.ai 上同一句是不渲染的(均实测)。
 *
 * 放在 mdast 层而非源字符串层:code / inlineCode / html 都是独立节点类型,
 * 只处理 text 节点就天然跳过它们,也不必给货币的 `$` 加转义。
 *
 * 判据(GitHub 那套):开 `$` 后紧跟非空白;内容不跨行、不含 `$`;闭 `$` 前非
 * 空白、后一位不是数字。`\(…\)` 和单行 `$$…$$` 由 normalize-math 处理。
 *
 * 限制:切分晚于强调解析,`$a*b*c$` 里的 `*b*` 会先被拆成 emphasis,公式就
 * 不成立了;`\(…\)` 写法不受影响。
 */

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: Record<string, unknown>
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

/** 从 open 处的 `$` 找合格闭合,失败返回 -1。 */
function findClose(value: string, open: number): number {
  const first = value[open + 1]
  if (first === undefined || isSpace(first) || first === '$') return -1

  for (let j = open + 1; j < value.length; j++) {
    const ch = value[j]
    if (ch === '\n') return -1
    if (ch !== '$') continue
    if (isSpace(value[j - 1])) return -1
    if (isDigit(value[j + 1])) return -1
    return j
  }
  return -1
}

/**
 * rehype-katex 靠 `math-inline` 认人。children 必须显式给 —— remark-math 是
 * 注册了 mdast→hast handler 把 `value` 铺成 text 的,我们没注册走 unknown
 * 分支,只给 `value` 会渲染出一个空公式(class 对、TeX 为空,很难发现)。
 */
function inlineMath(tex: string): MdNode {
  return {
    type: 'inlineMath',
    value: tex,
    children: [{ type: 'text', value: tex }],
    data: { hName: 'span', hProperties: { className: ['math', 'math-inline'] } },
  }
}

/** 无公式时返回 null,省下整个数组重建。 */
function splitText(value: string): MdNode[] | null {
  let out: MdNode[] | null = null
  let last = 0
  let i = 0

  while (i < value.length) {
    if (value[i] !== '$') {
      i++
      continue
    }
    const close = findClose(value, i)
    if (close === -1) {
      i++
      continue
    }
    if (!out) out = []
    if (i > last) out.push({ type: 'text', value: value.slice(last, i) })
    out.push(inlineMath(value.slice(i + 1, close)))
    i = close + 1
    last = i
  }

  if (!out) return null
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function walk(node: MdNode): void {
  const children = node.children
  if (!children) return
  let out: MdNode[] | null = null

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.type === 'text' && child.value !== undefined && child.value.includes('$')) {
      const parts = splitText(child.value)
      if (parts) {
        if (!out) out = children.slice(0, i)
        for (const p of parts) out.push(p)
        continue
      }
    } else if (child.children) {
      walk(child)
    }
    if (out) out.push(child)
  }

  if (out) node.children = out
}

export function remarkInlineDollarMath() {
  return (tree: MdNode) => walk(tree)
}
