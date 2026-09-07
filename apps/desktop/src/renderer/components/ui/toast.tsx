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

import { cn } from "../../lib/cn"
import { Anthropicon, type AnthropiconName } from '../icons'
import * as ToastPrimitives from '@radix-ui/react-toast'
import * as React from 'react'

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'pointer-events-none fixed z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col-reverse items-end gap-2',
      // 右下角。flex-col-reverse:新的在下、旧的往上顶,和"从底部升起"的入场同向。
      // items-end:卡片宽度跟内容走(见 Root 的 w-fit),长短不一时统一贴右沿对齐。
      //
      // --toast-clearance 是给底部固定元素(移动端的输入框等)留的避让位,
      // 默认 0 时就等价于纯 bottom-4;哪个页面被挡住了,在那个页面上把这个变量
      // 设成被挡高度即可,不用改这里。
      'right-4 bottom-[calc(var(--toast-clearance,0px)+1rem)]',
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

export type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'destructive'

/**
 * 语义色只落在**图标**上,卡面和正文一律中性。
 *
 * 原来是整条 toast 连正文一起染色(destructive 全红字、success 全蓝字),
 * 一句话通知被涂成一整块彩色,可读性反而差;而且描边也跟着换色,五个档就是
 * 五种边框。参照实现里卡面固定一个浮层表面、标题是 text-primary,只有前置
 * 图标带语义 —— 信息层级更干净。
 */
const toastToneClass: Record<ToastVariant, string> = {
  default: 'text-text-secondary',
  info: 'text-accent',
  success: 'text-accent',
  warning: 'text-warning',
  destructive: 'text-danger',
}

const Toast = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & {
    variant?: ToastVariant
  }
>(({ className, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(
        // 宽度跟内容走、到容器(360)封顶:"Copied" 这种短通知收成一颗小卡,
        // 长句才铺满换行。钉死 360 的话短文案右边会空掉一大截,读起来像没排版。
        'group pointer-events-auto relative w-fit max-w-full origin-bottom overflow-hidden rounded-xl text-sm text-text-primary',
        // 浮层表面:1px 描边环 + 两层投影,和 menuPanelClass 同构。不用 border ——
        // 描边走 box-shadow 才不占布局盒,卡片高度就是内容高度。
        // 投影走 --menu-shadow(含描边环),与下拉菜单/面板同一档;写死的话深色不翻。
        'bg-menu-surface shadow-[var(--menu-shadow)]',
        // 入场从下方升起、退场原地淡出微缩 —— 关键帧在 globals.css 的 .ui-toast。
        // 这里**不能**用 `animate-in slide-in-from-bottom-*`:本仓没装
        // tailwindcss-animate,那一整套是死类(改之前的 slide-in-from-right-full
        // 也从来没生效过,toast 一直是硬闪出来的)。
        'ui-toast',
        // 手势方向跟着位置走:右下角的卡片往**下**划走,所以取 swipe 的 Y 轴量
        // (ToastProvider 的 swipeDirection 也一起改成了 down)。
        'transition-transform data-[swipe=cancel]:translate-y-0 data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)] data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)]',
        className
      )}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-hairline bg-transparent px-3 text-sm font-medium outline-none transition-colors hover:bg-fill-secondary-hover focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-danger-line group-[.destructive]:hover:bg-danger-fill group-[.destructive]:hover:text-on-danger',
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      // 静止 muted / hover 提到主色 + 一层 ghost 底,和全站图标键一致。
      // 原来是整颗压 opacity-60 再 hover 到 100 —— 压 opacity 会把图标连同
      // 命中区一起变淡,而且和"语义色现在只在左侧图标上"这条对不上。
      // inline-flex 是必需的:<button> 默认 inline-block,里面那颗 16px 图标按
      // 行内盒排版,会吃到父级 20px 的 line-height 再加基线下沉,实测长成 29 高
      // (应该是 4+16+4=24),把整条 toast 顶高 3px。
      'inline-flex shrink-0 items-center justify-center cursor-pointer rounded-md p-1 text-text-muted outline-none transition-colors hover:bg-alpha-1 hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]',
      className
    )}
    toast-close=""
    {...props}
  >
    <Anthropicon name="x" size={16} />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-sm font-medium [&+div]:text-xs', className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-sm opacity-90', className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

// success 用带圈的勾:裸 check 在一句通知前面像个勾选框,圈起来才是"完成"。
const TOAST_ICONS: Record<ToastVariant, AnthropiconName> = {
  default: 'info',
  info: 'info',
  success: 'checkCircle',
  warning: 'warning',
  destructive: 'warning',
}

/** 20px —— 参照实测值,和 14px/20行高 的标题在同一行等高。 */
const ToastIcon = ({ variant }: { variant: ToastVariant }) => (
  <span className={cn('flex h-5 shrink-0 items-center', toastToneClass[variant])}>
    <Anthropicon name={TOAST_ICONS[variant]} size={20} />
  </span>
)

export {
  Toast, ToastAction, ToastClose, ToastDescription, ToastIcon, ToastProvider, ToastTitle, ToastViewport, type ToastActionElement, type ToastProps
}
