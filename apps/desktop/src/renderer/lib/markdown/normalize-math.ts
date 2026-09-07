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
 * 源字符串层的数学分隔符规范化,只做 mdast 层看不见的那部分。
 *
 * 两条实测约束:`\(` `\[` 是 CommonMark 转义标点,解析后 mdast 里只剩
 * `(` `[`,插件层救不回来;单行 `$$x$$` 会被解析成 inlineMath,只有独占三行
 * 的 `$$\nx\n$$` 才是 display —— 而模型恰恰爱写单行。
 *
 * 于是(均跳过代码区):
 *   `\(x\)`              → 单行 `$$x$$`,即 inline;走 math-text 不受强调
 *                            解析影响,也不过 `$x$` 的货币启发式
 *   `\[x\]` / 单行 `$$x$$` → 三行 display(emitDisplay,容器内退回行内)
 *   单个 `$`               → 不碰,交给 remarkInlineDollarMath
 *
 * 配对一律限制在当前段落内(下一个空行前):否则孤立的 `$$` 会跟几段之后另一条
 * 公式的开头配上,把中间正文整段吞进公式体。
 *
 * 取舍:`\[…\]` 在 CommonMark 里本是字面方括号,这里一律当 display 公式。
 */

/** 围栏代码块开/闭行 */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
/** 缩进代码块行(4 空格或 tab) */
const INDENT_CODE_RE = /^(?: {4}|\t)/
/** 行首列表标记(必须跟空白才算) */
const LIST_MARKER_RE = /^([-*+]|\d{1,9}[.)])[ \t]/

/** at 所在行、at 之前的部分,拆成 前导空白 + 其余。 */
function lineContext(s: string, at: number): { lead: string; rest: string } {
  const lineStart = s.lastIndexOf('\n', at - 1) + 1
  const before = s.slice(lineStart, at)
  const lead = (before.match(/^[ \t]*/) || [''])[0]
  return { lead, rest: before.slice(lead.length) }
}

/** 注入裸换行会拆散的位置:表格行、引用行、列表标记行、深缩进(≥4 或 tab)。 */
function inContainer(lead: string, rest: string): boolean {
  return (
    rest.startsWith('|') ||
    rest.startsWith('>') ||
    LIST_MARKER_RE.test(rest) ||
    lead.includes('\t') ||
    lead.length >= 4
  )
}

/** 从 from 起当前段落的结束位置(下一个空行的起点),没有则 -1。 */
function paragraphEnd(s: string, from: number): number {
  const rx = /\n[ \t]*\n/g
  rx.lastIndex = from
  const m = rx.exec(s)
  return m ? m.index : -1
}

/** close 落在段落窗口内才算配上对。 */
function inParagraph(close: number, parEnd: number): boolean {
  return close !== -1 && (parEnd === -1 || close < parEnd)
}

/**
 * 摊成独占三行的 `$$`(只有这个形状 remark-math 才给 display)。行前导空白
 * 复制到每一行,列表项内的公式靠它留在项内;容器里退回单行,结构优先。
 */
function emitDisplay(s: string, at: number, body: string): string {
  const { lead, rest } = lineContext(s, at)
  if (inContainer(lead, rest)) return `$$${body}$$`
  const lines = body
    .split('\n')
    .map((l) => lead + l)
    .join('\n')
  // 尾部再补一个 lead:公式后同一行的余文靠它留在原容器里
  return `\n\n${lead}$$\n${lines}\n${lead}$$\n\n${lead}`
}

/** chunk 内的字符级扫描:只在这里做改写,调用方保证 chunk 不含代码块行。 */
function transformChunk(s: string): string {
  let out = ''
  let i = 0
  const n = s.length

  while (i < n) {
    const c = s[i]

    // 行内代码 `…` / ``…``:整段原样带过
    if (c === '`') {
      let len = 1
      while (i + len < n && s[i + len] === '`') len++
      const ticks = s.slice(i, i + len)
      const close = s.indexOf(ticks, i + len)
      const end = close === -1 ? i + len : close + len
      out += s.slice(i, end)
      i = end
      continue
    }

    if (c === '\\' && i + 1 < n) {
      const next = s[i + 1]

      if (next === '(' || next === '[') {
        const close = s.indexOf(next === '(' ? '\\)' : '\\]', i + 2)
        const body = inParagraph(close, paragraphEnd(s, i)) ? s.slice(i + 2, close).trim() : ''
        if (body && !body.includes('$')) {
          out +=
            next === '('
              ? // 行内:单行 `$$…$$` 即 inlineMath;折行压成空格
                `$$${body.replace(/\s*\n\s*/g, ' ')}$$`
              : emitDisplay(s, i, body)
          i = close + 2
          continue
        }
      }

      // 其余转义原样带过。必须跳两个字符,否则 `\\(` 里的 `\(` 会被误判
      out += c + next
      i += 2
      continue
    }

    if (c === '$' && s[i + 1] === '$') {
      const parEnd = paragraphEnd(s, i)
      const close = s.indexOf('$$', i + 2)
      if (inParagraph(close, parEnd)) {
        const body = s.slice(i + 2, close).trim()
        // 空体($$$$、$$ $$)不是公式,原样带过
        out += body ? emitDisplay(s, i, body) : s.slice(i, close + 2)
        i = close + 2
        continue
      }
      if (parEnd !== -1) {
        // 孤立 `$$`:原样放行,绝不能跟后文公式的开头配对
        out += '$$'
        i += 2
        continue
      }
      // 未闭合到文本末尾 —— 流式期每条 display 公式的必经状态。摊成三行开头,
      // 让已到达的内容渐进渲染;原样留着则同行内容会被 micromark 当 meta 丢掉,
      // 公式框空着直到收尾才整个蹦出来。残缺 TeX 由 KaTeX errorColor 兜。
      const { lead, rest } = lineContext(s, i)
      if (inContainer(lead, rest)) {
        out += '$$'
        i += 2
        continue
      }
      out += `\n\n${lead}$$\n${s.slice(i + 2).replace(/^[ \t]+/, '')}`
      i = n
      continue
    }

    out += c
    i++
  }

  return out
}

export function normalizeMathDelimiters(src: string): string {
  if (!src) return src
  // 热路径:流式期每 flush 都走一次,绝大多数消息一个分隔符都没有
  if (!src.includes('$') && !src.includes('\\(') && !src.includes('\\[')) return src

  const lines = src.split('\n')
  const out: string[] = []
  const buf: string[] = []
  let fence: string | null = null
  let inIndentCode = false
  let prevBlank = true

  const flush = () => {
    if (buf.length > 0) {
      out.push(transformChunk(buf.join('\n')))
      buf.length = 0
    }
  }

  for (const line of lines) {
    const blank = line.trim() === ''

    if (fence !== null) {
      out.push(line)
      const m = FENCE_RE.exec(line)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
      prevBlank = blank
      continue
    }

    const fm = FENCE_RE.exec(line)
    if (fm) {
      flush()
      fence = fm[1]
      inIndentCode = false
      out.push(line)
      prevBlank = false
      continue
    }

    if (inIndentCode) {
      if (blank || INDENT_CODE_RE.test(line)) {
        out.push(line)
        prevBlank = blank
        continue
      }
      inIndentCode = false
    } else if (prevBlank && INDENT_CODE_RE.test(line)) {
      // 缩进代码块不能中断段落,只在空行(或文首)后起头 —— 这条前置判断
      // 也正是列表续行不被误当代码的原因。
      flush()
      inIndentCode = true
      out.push(line)
      prevBlank = blank
      continue
    }

    buf.push(line)
    prevBlank = blank
  }

  flush()
  return out.join('\n')
}
