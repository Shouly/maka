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

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

import { cn } from '../../lib/cn'

// [&>span]:min-w-0 —— 与 Claude 的 header 按钮一致。控件里包一层 span 再放
// truncate 文本是常见写法(要跟图标并排时尤其如此),而中间这层 span 若是
// inline-flex 且没有 overflow:hidden,min-width:auto 会让它拒绝收窄到内容宽度
// 以下,里层的 truncate 就永远轮不到生效,整个标题把 header 顶出去。
export const mainHeaderTextControlClass =
  'relative inline-flex h-7 min-w-0 items-center rounded-[7px] px-2.5 text-sm leading-5 text-sidebar-text-primary transition-[background-color,color,box-shadow] hover:bg-sidebar-menu-hover focus-visible:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] [&>span]:min-w-0'

export const mainHeaderTextLabelClass =
  'inline-flex h-7 min-w-0 items-center px-2.5 text-sm leading-5 text-sidebar-text-primary'

export const mainHeaderIconControlClass =
  // hover 用 5%(ghost 档),与同一行的标题/动作按钮一致 —— 之前这里是 10%
  // (sidebar-control-hover),紧挨着标题时明显比标题的底色深一档。
  'relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-sidebar-text-muted transition-[background-color,color,box-shadow] hover:bg-sidebar-menu-hover hover:text-sidebar-text-primary focus-visible:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]'

// 里面的图标显式传 size,别吃 Anthropicon 的默认:同一排里各图标在 spec 表登记
// 的默认有 16 也有 20,不传就会大小不一。字号是内联 style,类名压不过去。
//
// 单聊和群聊统一 18。群聊那排曾经是 20(理由:夹着 24px 的成员头像堆,18 挨着
// 显小),后来连头像堆一起收到 20 + ring-2(视觉外径 24),18 的图标就不再显小了
// —— 两处一起改才成立,只改一边会把那排重新拉花。
export const mainHeaderActionControlClass =
  'relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-sidebar-text-primary transition-[background-color,box-shadow] hover:bg-sidebar-menu-hover focus-visible:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]'

interface MainHeaderActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export const MainHeaderActionButton = forwardRef<
  HTMLButtonElement,
  MainHeaderActionButtonProps
>(function MainHeaderActionButton(
  { active = false, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        mainHeaderActionControlClass,
        active && 'bg-sidebar-menu-hover text-sidebar-text-primary',
        className,
      )}
      {...props}
    />
  )
})

interface MainHeaderBreadcrumbProps {
  /**
   * 参照实现这里是 `next/link` 的 `href`。Maka 的主进程会拦下所有导航
   * (`will-navigate` preventDefault),渲染进程里没有 URL 路由,所以面包屑的
   * 那一段是个按钮 + 回调,不是链接。
   */
  onClick: () => void
  children: ReactNode
  className?: string
  linkClassName?: string
}

export function MainHeaderBreadcrumb({
  onClick,
  children,
  className,
  linkClassName,
}: MainHeaderBreadcrumbProps) {
  return (
    <div className={cn('-ml-1 inline-flex min-w-0 shrink-[4] items-center', className)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(mainHeaderTextControlClass, 'cursor-pointer !shrink', linkClassName)}
      >
        {children}
      </button>
      <span aria-hidden="true" className="px-0.5 text-sidebar-text-muted opacity-50">/</span>
    </div>
  )
}

interface MainHeaderTitleLabelProps {
  children: ReactNode
  weight?: 'regular' | 'medium'
  className?: string
}

export function MainHeaderTitleLabel({
  children,
  weight = 'regular',
  className,
}: MainHeaderTitleLabelProps) {
  return (
    <div
      className={cn(
        mainHeaderTextLabelClass,
        weight === 'medium' ? 'font-medium' : 'font-normal',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface MainHeaderProps {
  /** The title/breadcrumb/session controls rendered after the context glyph. */
  title: ReactNode
  /** Desktop context glyph. Hidden on mobile where the Sidebar toggle owns the slot. */
  contextIcon?: ReactNode
  /** Mobile-only Sidebar control retained by the existing page. */
  mobileToggle?: ReactNode
  /** Connection or generation state placed directly after the title slot. */
  status?: ReactNode
  /** Page actions aligned to the right edge of the same Header row. */
  actions?: ReactNode
  /** Detail pages use sticky; conversation headers use relative. */
  position?: 'relative' | 'sticky'
  className?: string
  rowClassName?: string
  titleSlotClassName?: string
}

/**
 * Claude-style top-level application Header.
 *
 * This component owns geometry only. Routing, permissions, rename state and
 * menu callbacks stay in the caller and are passed through the slots above.
 */
export function MainHeader({
  title,
  contextIcon,
  mobileToggle,
  status,
  actions,
  position = 'relative',
  className,
  rowClassName,
  titleSlotClassName,
}: MainHeaderProps) {
  return (
    <header
      className={cn(
        // 底色不画在 header 上,由下面那层 backdrop 一次画完 48+24 —— 见它的注释。
        // isolate:backdrop 是 z-[-1],header 必须自成层叠上下文,否则它会掉到
        // 祖先背景后面去。
        // 两个分支都必须带 z:那 24px 下探悬在正文之上,而正文的滚动容器是更晚的
        // 定位兄弟(z-auto),不给 header 提层就会把下探段整个盖掉 —— 底色在
        // header 里而遮罩在外面时靠遮罩自己的 z 撑着,现在合成一个元素了,得由
        // header 来提。
        'isolate h-12 shrink-0 overflow-visible',
        position === 'sticky' ? 'sticky top-0 z-20' : 'relative z-10',
        className,
      )}
    >
      <div
        className={cn(
          'app-header-sidebar-clearance flex h-full min-w-0 items-center gap-3 pl-2 pr-3 md:pl-4',
          rowClassName,
        )}
      >
        {mobileToggle}
        <div
          className={cn(
            'flex min-w-0 shrink items-center gap-2',
            titleSlotClassName,
          )}
        >
          {contextIcon && (
            <span className="hidden size-4 shrink-0 items-center justify-center text-sidebar-text-secondary md:flex">
              {contextIcon}
            </span>
          )}
          <div className="flex min-w-0 items-center text-sm leading-5 text-sidebar-text-primary">
            {title}
          </div>
        </div>
        {status}
        <div aria-hidden="true" className="min-w-0 flex-1" />
        {actions && (
          <div className="flex shrink-0 items-center gap-1">
            {actions}
          </div>
        )}
      </div>

      {/* header 的底色 + 下缘淡出,一个元素画完。
          `inset-0 -bottom-6` = 48(header) + 24(下探),共 72;mask 的 66.67%
          正是 48/72 —— 底色在 header 高度内 100% 不透明,越过底边才开始淡。

          ! 不要退回"header 自己 bg-surface-1 + 下面挂一条渐变带"的两元素写法:
          同一片底色由两个盒子分别绘制,y=48 那条交界在任何非整数高度/缩放下都
          会露缝。淡出效果两者逐像素相同(实测偏差 ≤1/255),换掉只为消掉这条缝。

          z-[-1]:落在 header 背景之后、内容之前,不参与页面层叠竞争。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -bottom-6 z-[-1] bg-surface-1 [mask-image:linear-gradient(to_bottom,black_66.67%,transparent)]"
      />
    </header>
  )
}
