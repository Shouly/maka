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

import {Anthropicon} from '../icons'
import {
  processChildrenColorValues,
  hasColorValue,
  INLINE_CODE_CLASS,
  INLINE_CODE_COLOR_CLASS,
} from '../../lib/markdown/color-utils'
import 'katex/dist/katex.min.css'
import React, { useId, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import CodeRenderer from './CodeRenderer'
import { processTokenChildren } from '../../lib/markdown/inline-tokens'
import { rehypeStripBreakNewlines } from '../../lib/markdown/rehype-strip-break-newlines'
import { rehypeStreamPop } from '../../lib/markdown/rehype-stream-pop'
import { normalizeMathDelimiters } from '../../lib/markdown/normalize-math'
import { remarkInlineDollarMath } from '../../lib/markdown/remark-inline-math'

interface MarkdownProps {
  children: string
  className?: string
  noPadding?: boolean // 是否禁用默认padding
  variant?: 'default' | 'muted' // 文本颜色变体
  /** 把 @kebab-name / /kebab-name 渲染成 styled token(text-accent 文字色)。
   *  仅用于用户消息(user 输入的 mention/skill 召唤)。AI 消息不开,避免
   *  误识别 AI 输出里的路径或代码片段为 mention。 */
  processInlineTokens?: boolean
  /** processInlineTokens 之外再按名单识别 @真人名(频道消息的 mentions);见 inline-tokens */
  inlineTokenNames?: string[]
  /** Drop rehypeRaw so embedded raw HTML is rendered as inert text, not live
   *  DOM. Use for UNTRUSTED free-text (e.g. a responder's typed answer shown to
   *  another user) — prevents stored XSS. Markdown formatting still works. */
  disableRawHtml?: boolean
  /** 流式"尾部渐显"入场:把文本切成 token span,新挂载的 span 播放入场
   *  动画(见 rehype-stream-pop / globals.css 的 .stream-pop)。只给流式
   *  草稿期用(通常经由 StreamPopMarkdown 攒批调用);定稿渲染不要开。 */
  streamPop?: boolean
  /**
   * 外部 http(s) 链接的去处。参照实现开 `target="_blank"` 交给浏览器;桌面端
   * 主进程会拦下所有导航和新窗口(`will-navigate` preventDefault、
   * `setWindowOpenHandler` deny),`_blank` 只会静默失败 —— 所以外链一律
   * preventDefault 后交给这个回调,由 Phase 1 接到 `app.openPath` / shell。
   * 不给回调时外链渲染成不可点的文字,不会假装能跳转。
   */
  onOpenExternal?: (url: string) => void
}


export default function Markdown({ children, className = '', noPadding = false, variant = 'default', processInlineTokens = false, inlineTokenNames, disableRawHtml = false, streamPop = false, onOpenExternal }: MarkdownProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCode(text)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  // 根据 variant 决定文本颜色类
  const textColorClass = variant === 'muted' ? 'text-text-secondary' : 'text-text-primary'

  // 数学分隔符规范化(详见 normalize-math.ts)。无分隔符时原样返回。
  const source = useMemo(() => normalizeMathDelimiters(children), [children])

  // 脚注 id 的每实例前缀:remark-rehype 默认给所有消息发同一套
  // `user-content-fn-1`,同一会话里两条带脚注的消息会撞 id,点第二条的角标
  // 跳到第一条。React 19 的 useId 不含冒号,可直接进 href。
  const footnotePrefix = `fn-${useId()}-`

  return (
    // 块间距 = 容器 gap-3(12px,claude.ai Cowork 实测),标题/列表/表格再用
    // 自身的 mt/-mb 做增减。最后一块清零,避免容器尾部多出一段空白。
    <div className={`markdown-body ${textColorClass} leading-[1.65rem] whitespace-normal break-words relative grid grid-cols-1 gap-3 [&>*]:min-w-0 [&>*:last-child]:mb-0 ${noPadding ? '' : 'standard-markdown'} ${className}`}>
      <ReactMarkdown
        // remarkMath 只管 `$$…$$`;singleDollarTextMath 必须保持关闭 ——
        // 打开会把 "It costs $100 and $200" 里的 "100 and " 当成公式。
        // `$x$` 由 remarkInlineDollarMath 在 mdast 上按启发式切。
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkInlineDollarMath]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        rehypePlugins={[
          // 排在 rehypeRaw 之前:raw 节点对 strip 插件不透明,作者手写 HTML
          // (<pre> 内容、字面 <br>)的真实换行不会被误删,详见插件头注释。
          rehypeStripBreakNewlines,
          ...(disableRawHtml ? [] : [rehypeRaw]),
          // errorColor:残缺 TeX 以此色原样显示。默认是红 #cc0000,而流式期
          // display 公式几乎每次 flush 都处于花括号未配平状态,会一闪一闪地红。
          [rehypeKatex, { strict: false, errorColor: 'var(--text-muted)' }],
          // 必须最后:只切"最终可见文本",KaTeX 产物靠类名跳过
          ...(streamPop ? [rehypeStreamPop] : []),
        ]}
        components={{
          // ! 每个渲染器签名都必须显式接住 node —— react-markdown v10 会把原始
          // mdast 节点当 node prop 传进来,它是给程序用的对象,不是 HTML 属性。
          // 不解构出来,它就会跟着 {...props} 摊到标签上,渲染成
          // <li node="[object Object]">。React 19 对对象值的未知属性是**静默**
          // 写进 DOM 的(只有函数/symbol 值才告警),所以这事儿不会有任何提示。
          // claude.ai 实测:它的 p/li/strong/td 上没有这种属性,全是有意挂的
          // class / dir / data-sourcepos / scope。
          // 起成 _node 是本仓 lint 约定(no-unused-vars 的 argsIgnorePattern
          // 是 ^_),别嫌下划线多余把它去掉 —— 去掉就是 19 条 warning。
          // 不抽公共 helper 去剥:流式期间每个 token 都整棵重渲染,那是热
          // 路径,解构是零成本的,helper 会给每个元素多一次调用+一次分配。
          // 代码块
          code({ node, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '')
            const language = match ? match[1] : ''
            const codeString = String(children).replace(/\n$/, '')

            // 更可靠的行内代码判断：
            // 1. 检查父节点是否是 <pre>（代码块会被包裹在 <pre> 中）
            // 2. 检查内容是否包含换行符（行内代码通常不包含换行）
            const hasParentPre = node?.parent?.tagName === 'pre'
            const hasMultipleLines = codeString.includes('\n')
            const inline = !hasParentPre && !hasMultipleLines

            if (!inline && language) {
              return (
                <div className="relative group/code border border-hairline rounded-lg bg-surface-2/50">
                  {/* 复制按钮 */}
                  <button
                    className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-md hover:bg-alpha-1 active:scale-95 transition-colors z-10 opacity-0 group-hover/code:opacity-100 cursor-pointer"
                    onClick={() => copyToClipboard(codeString)}
                  >
                    {copiedCode === codeString ? (
                      <Anthropicon name="check" size={20} />
                    ) : (
                      <Anthropicon name="copy" size={20} />
                    )}
                  </button>

                  {/* 语言标签 */}
                  <div className="p-3.5 pb-0 text-xs text-text-muted">
                    <span className="font-mono font-normal">{language}</span>
                  </div>

                  <div className="p-3.5 overflow-x-auto">
                    <CodeRenderer
                      content={codeString}
                      language={language}
                      showLineNumbers={false}
                    />
                  </div>
                </div>
              )
            }

            // 无语言的代码块
            if (!inline) {
              return (
                <div className="relative group/code border border-hairline rounded-lg bg-surface-2/50">
                  {/* 复制按钮 */}
                  <button
                    className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-md hover:bg-alpha-1 active:scale-95 transition-colors z-10 opacity-0 group-hover/code:opacity-100 cursor-pointer"
                    onClick={() => copyToClipboard(codeString)}
                  >
                    {copiedCode === codeString ? (
                      <Anthropicon name="check" size={20} />
                    ) : (
                      <Anthropicon name="copy" size={20} />
                    )}
                  </button>

                  <pre className="p-3.5 overflow-x-auto">
                    <code className="font-mono font-normal text-sm">{codeString}</code>
                  </pre>
                </div>
              )
            }

            // 行内代码
            // 含色值时壳自己切成 inline-flex 定高(claude.ai 实测结构),色点作为
            // 直接子节点插在文本前;色值用 bare 模式渲染,不再自带壳。
            // (外层 p/li/td 的 processChildrenColorValues 会跳过 code 子树,
            //  否则那边先包一层带壳的 ColorSwatch,跟这层壳叠成两个背景框。)
            const hasColor = hasColorValue(codeString)
            return (
              <code
                className={hasColor ? `${INLINE_CODE_CLASS} ${INLINE_CODE_COLOR_CLASS}` : INLINE_CODE_CLASS}
                {...props}
              >
                {hasColor ? processChildrenColorValues(children, { bare: true }) : children}
              </code>
            )
          },

          // 链接。claude.ai 实测(明暗都测):文字 --text-accent(色值逐位相同),
          // 下划线同色 40% alpha,hover 补到 100% —— 文字色始终不变。粗细 auto
          // 不写死 1px,offset 3px。
          a({ node: _node, href, className, children, ...props }) {
            // 页内锚点(脚注角标/回跳)留给浏览器自己滚,不当外链处理。除它和外链
            // 之外的一切 href 都渲染成不可点:主进程拦下所有导航,让它们看着能点
            // 只会得到一次静默的无事发生。
            const isAnchor = typeof href === 'string' && href.startsWith('#')
            // 外链交给宿主打开(见 onOpenExternal 的注释)。`maka://` 的处理
            // TODO(phase-3):接 `@maka/ui` 的 `maka-uri.ts`(parseMakaUri /
            // 资源跳转),那时这里会多一个分支,不要在 Phase 0b 抢跑。
            const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href)
            // className 必须合并:remark-gfm 给回跳链接挂了 data-footnote-backref
            // 类,而 {...props} 摊在 className 之后会把链接样式整个替掉。
            const isBackref = 'data-footnote-backref' in props
            return (
              <a
                href={href}
                {...(isExternal
                  ? {
                      rel: 'noopener noreferrer',
                      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
                        event.preventDefault()
                        onOpenExternal?.(href as string)
                      },
                    }
                  : {})}
                {...props}
                className={`${isAnchor || (isExternal && onOpenExternal) ? '' : 'pointer-events-none '}text-accent underline underline-offset-[3px] decoration-accent/40 hover:decoration-accent transition-colors${className ? ` ${className}` : ''}`}
              >
                {/* 回跳的 ↩(U+21A9)有 emoji 变体,默认会 fallback 成彩色方块
                    图标(实测截图确认),color 也就压不住了。补 U+FE0E 强制文本呈现。 */}
                {isBackref ? '\u21a9\ufe0e' : children}
              </a>
            )
          },

          // 表格
          table({ node: _node, children, ...props }) {
            return (
              <div className="overflow-x-auto w-full px-2 mb-6">
                <table className="min-w-full border-collapse text-sm leading-[1.7] whitespace-normal" {...props}>
                  {children}
                </table>
              </div>
            )
          },

          thead({ node: _node, children, ...props }) {
            return (
              <thead className="text-left" {...props}>
                {children}
              </thead>
            )
          },

          // 表头 font-bold 是 600 那一档(见 globals.css 的字重刻度):上游实测
          // 就是 600,不是 semibold 的 580。
          th({ node: _node, children, ...props }) {
            return (
              <th className="border-b border-alpha-6 py-2 pr-4 align-top font-bold" {...props}>
                {processChildrenColorValues(children)}
              </th>
            )
          },

          td({ node: _node, children, ...props }) {
            return (
              <td className="border-b border-alpha-4 py-2 pr-4 align-top" {...props}>
                {processChildrenColorValues(children)}
              </td>
            )
          },

          tbody({ node: _node, children, ...props }) {
            return (
              <tbody {...props}>
                {children}
              </tbody>
            )
          },

          tr({ node: _node, children, ...props }) {
            return (
              <tr {...props}>
                {children}
              </tr>
            )
          },

          // 引用块
          blockquote({ node: _node, children, ...props }) {
            return (
              <blockquote
                className="ml-2 border-l-4 border-hairline pl-4 leading-[1.65rem] text-text-secondary"
                {...props}
              >
                {processChildrenColorValues(children)}
              </blockquote>
            )
          },

          // 列表
          ul({ node: _node, children, ...props }) {
            return (
              <ul className="list-disc flex flex-col gap-2 pl-8 mb-3" {...props}>
                {children}
              </ul>
            )
          },

          ol({ node: _node, children, ...props }) {
            return (
              <ol className="list-decimal flex flex-col gap-2 pl-8 mb-3" {...props}>
                {children}
              </ol>
            )
          },

          li({ node: _node, children, ...props }) {
            const processed = processChildrenColorValues(children)
            return (
              <li className="whitespace-normal break-words pl-2" {...props}>
                {processInlineTokens ? processTokenChildren(processed, inlineTokenNames) : processed}
              </li>
            )
          },

          // 分隔线
          hr({ node: _node, ...props }) {
            return (
              <hr className="border-t border-hairline mx-1.5 my-3" {...props} />
            )
          },

          // 标题
          h1({ node: _node, children, ...props }) {
            return (
              <h1 className="text-[1.375rem] leading-[1.65rem] font-semibold mt-3 -mb-1" {...props}>
                {processChildrenColorValues(children)}
              </h1>
            )
          },

          h2({ node: _node, children, ...props }) {
            return (
              <h2 className="text-[1.125rem] leading-[1.65rem] font-semibold mt-3 -mb-1" {...props}>
                {processChildrenColorValues(children)}
              </h2>
            )
          },

          h3({ node: _node, children, ...props }) {
            return (
              <h3 className="text-base leading-[1.65rem] font-semibold mt-2 -mb-1" {...props}>
                {processChildrenColorValues(children)}
              </h3>
            )
          },

          h4({ node: _node, children, ...props }) {
            return (
              <h4 className="text-base leading-[1.65rem] font-semibold mt-2 -mb-1" {...props}>
                {processChildrenColorValues(children)}
              </h4>
            )
          },

          h5({ node: _node, children, ...props }) {
            return (
              <h5 className="text-base leading-[1.65rem] font-semibold mt-2 -mb-1" {...props}>
                {processChildrenColorValues(children)}
              </h5>
            )
          },

          // 段落
          p({ node: _node, children, ...props }) {
            const processed = processChildrenColorValues(children)
            return (
              <p className="whitespace-normal break-words" {...props}>
                {processInlineTokens ? processTokenChildren(processed, inlineTokenNames) : processed}
              </p>
            )
          },

          // 加粗:浏览器默认 <strong> 是 700,claude.ai 实测 600 —— 700 太重,
          // 会把整段的灰度节奏打断。
          // 用 font-bold 不是 font-semibold:本仓的字重刻度按 CDS 定成
          // medium 500 / semibold 580 / bold 600,600 那一档叫 bold。
          // 上游的规则也是 :is(h1..h6, strong, b) { font-weight: bold(600) }。
          strong({ node: _node, children, ...props }) {
            return (
              <strong className="font-bold" {...props}>
                {processChildrenColorValues(children)}
              </strong>
            )
          },

        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
