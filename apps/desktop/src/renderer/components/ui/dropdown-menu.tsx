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

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Anthropicon } from '../icons'
import * as React from "react"

import { cn } from "../../lib/cn"
import {
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
  menuShellClass,
  type MenuVariant,
} from "./menu-variants"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

/**
 * 所有 variant 共用同一套视觉(Claude 的菜单只有一种长相,全局最小宽度
 * 128px,更宽的产品菜单在调用点自行 opt in)。`variant` 不参与样式,它只表达
 * **浮层归属**:`sidebar` 会在内容根节点打上 `data-sidebar-overlay`,让收起态
 * 悬停预览知道"这个菜单是我的,别在它开着的时候把面板收回去"。
 *
 * 因此 variant 只出现在真正渲染浮层根节点的 Content / SubContent 上;
 * Item / CheckboxItem / RadioItem / Separator 收不到这个标记,也就不接这个 prop。
 */
/** DropdownMenu 只渲染列表型菜单,富内容面板走 Popover 的 `panel` 档。 */
type DropdownMenuVariant = Exclude<MenuVariant, 'panel'>

const sidebarOverlayAttr = (variant: DropdownMenuVariant) =>
  variant === 'sidebar' ? 'true' : undefined

/**
 * 子菜单触发器
 */
const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      menuItemClass,
      "data-[state=open]:bg-menu-hover",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <div className="size-4 flex items-center justify-center">
      <Anthropicon name="caretRight" size={16} className="text-menu-text-muted" />
    </div>
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

/**
 * 子菜单内容。
 * `sideOffset = 6`:锚点是触发行,它比父面板右缘内缩 4(根节点 p-1),
 * 再留 2 的间隙 —— 负值会让两层描边环叠在一起。
 * `shell`:切到 scroll + pinned 布局,见 DropdownMenuScrollArea。
 */
const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> & {
    variant?: DropdownMenuVariant
    shell?: boolean
  }
>(({ className, sideOffset = 6, variant = "menu", shell, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      data-sidebar-overlay={sidebarOverlayAttr(variant)}
      className={cn(
        menuContentClass,
        shell && menuShellClass,
        className
      )}
      {...props}
    >
      {shell ? (
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[inherit]">
          {children}
        </div>
      ) : (
        children
      )}
    </DropdownMenuPrimitive.SubContent>
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

/**
 * shell 布局:PinnedTop? → ScrollArea → PinnedBottom?,配 <SubContent shell>。
 * 只有变长的列表进 ScrollArea,固定行留在外面(否则列表一长就把它顶没了)。
 * padding 从根节点搬到这三块,PinnedBottom 的 -mt-1 抵掉滚动区那 4px。
 */
const DropdownMenuScrollArea = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('min-h-0 flex-1 overflow-y-auto scroll-fade-y p-1', className)}
    {...props}
  />
)
DropdownMenuScrollArea.displayName = 'DropdownMenuScrollArea'

const DropdownMenuPinnedTop = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('shrink-0 px-1 pt-1', className)} {...props} />
)
DropdownMenuPinnedTop.displayName = 'DropdownMenuPinnedTop'

const DropdownMenuPinnedBottom = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('-mt-1 shrink-0 px-1 pb-1', className)} {...props} />
)
DropdownMenuPinnedBottom.displayName = 'DropdownMenuPinnedBottom'

/**
 * 主菜单内容
 */
const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    variant?: DropdownMenuVariant
  }
>(({ className, sideOffset = 4, collisionPadding = 8, variant = "menu", ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      data-sidebar-overlay={sidebarOverlayAttr(variant)}
      className={cn(
        menuContentClass,
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

/**
 * 普通菜单项
 */
const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      menuItemClass,
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

/**
 * 复选框菜单项 - 选中时显示统一的蓝色 Anthropicon 对号
 */
const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & {
    indicator?: React.ReactNode
  }
>(({ className, children, checked, indicator, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      menuItemClass,
      className
    )}
    checked={checked}
    {...props}
  >
    <div className="flex gap-2 truncate items-center flex-1">
      {children}
    </div>
    {/* 选中时显示勾选图标 */}
    <DropdownMenuPrimitive.ItemIndicator className="ml-auto flex size-5 items-center justify-center text-menu-accent">
      {indicator ?? <Anthropicon name="check" size={20} weight={566.5} />}
    </DropdownMenuPrimitive.ItemIndicator>
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

/**
 * 单选菜单项
 */
const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & {
    indicator?: React.ReactNode
  }
>(({ className, children, indicator, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      menuItemClass,
      className
    )}
    {...props}
  >
    <div className="flex gap-2 truncate items-center flex-1">
      {children}
    </div>
    <DropdownMenuPrimitive.ItemIndicator
      className="ml-auto flex size-5 items-center justify-center text-menu-accent"
    >
      {indicator ?? <Anthropicon name="check" size={20} weight={566.5} />}
    </DropdownMenuPrimitive.ItemIndicator>
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

/**
 * 菜单标签
 */
const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "flex min-h-8 items-center px-2.5 py-1.5 text-sm leading-5 font-normal text-menu-text-primary",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

/**
 * 分隔符 - Claude menu 的 1px hairline
 */
const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn(menuSeparatorClass, className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

/** 快捷键提示：Claude 菜单中始终可见。 */
const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap text-right text-[13px] leading-4 text-menu-text-muted",
        className
      )}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

/**
 * 菜单项图标容器 - 20x20 尺寸
 */
const DropdownMenuItemIcon = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn("size-5 flex items-center justify-center shrink-0", className)}
      {...props}
    >
      {children}
    </div>
  )
}
DropdownMenuItemIcon.displayName = "DropdownMenuItemIcon"

/**
 * 菜单项骨架屏 - 用于加载状态
 * @param count - 显示几个骨架项，默认 3
 */
const DropdownMenuItemSkeleton = ({
  count = 3,
  className,
}: {
  count?: number
  className?: string
}) => {
  return (
    // ! 不要加行间距:真实菜单行之间没有 margin,骨架写 space-y-1 会比 N 条真实
    // 行高 4(N-1)px,数据到达时面板高度突变(实测 3 条差 8px,浮层顶边跳一下)。
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          // px-2.5 必须与 menuItemClass 同值,否则数据一到图标横跳 2px
          className="flex items-center gap-2 px-2.5 py-1.5 min-h-8"
        >
          <div className="size-5 rounded bg-skeleton animate-pulse shrink-0" />
          <div
            className="h-4 rounded bg-skeleton animate-pulse"
            style={{ width: `${60 + Math.random() * 30}%` }}
          />
        </div>
      ))}
    </div>
  )
}
DropdownMenuItemSkeleton.displayName = "DropdownMenuItemSkeleton"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuItemIcon,
  DropdownMenuItemSkeleton,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuScrollArea,
  DropdownMenuPinnedTop,
  DropdownMenuPinnedBottom,
}
