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

import * as SelectPrimitive from "@radix-ui/react-select"
import * as React from "react"

import { Anthropicon } from '../icons/Anthropicon'
import { cn } from "../../lib/cn"
import { fieldSurfaceClass } from "./field-surface"
import {
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
} from "./menu-variants"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      // 和 Input 共用 fieldSurfaceClass:Select 是表单字段,不该和相邻的输入框
      // 长成两个样。原来是 h-10(40px) + 真 border + bg-background(页面底色),
      // 比同一行的 Input(32) 高 8px。
      fieldSurfaceClass,
      "h-9 md:h-8 px-3 flex items-center justify-between gap-2 text-left cursor-pointer",
      // 展开时保持 hover 的描边,让"这个字段正被操作"一直可见
      "data-[state=open]:shadow-[var(--field-shadow-hover)]",
      // SelectValue 的 placeholder 态由触发器承载
      "data-[placeholder]:text-text-muted",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <Anthropicon name="caretDown" className="text-text-muted" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        menuContentClass,
        // p-0:内边距由 Viewport 承担(它才是滚动容器),不能和 menu 的 p-1 叠加。
        // max-w-none:触发器是整行宽的表单字段,Viewport 又要求
        // min-width = 触发器宽度,菜单默认的 max-w-80 会把它夹住。
        "relative p-0 max-w-none",
        // 高度上限用 Radix 算好的"到视口边缘还剩多少",超出才滚动。
        position === "popper" &&
        "max-h-[var(--radix-select-content-available-height)] data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          "p-1 overflow-y-auto",
          // 只约束宽度。不要写 h-[var(--radix-select-trigger-height)] ——
          // 那会把整个下拉面板压成触发器那么高(32px),所有选项挤进一个
          // 内部滚动条里。
          position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      "flex min-h-8 items-center px-2.5 py-1.5 text-sm leading-5 font-normal text-menu-text-muted",
      className
    )}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      // 勾选标记绝对定位在右侧,给它留出 pr-8 的落位空间
      menuItemClass,
      "w-full pr-8",
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>

    <span className="absolute right-2 flex size-5 items-center justify-center text-menu-accent">
      <SelectPrimitive.ItemIndicator>
        <Anthropicon name="check" size={20} weight={566.5} />
      </SelectPrimitive.ItemIndicator>
    </span>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn(menuSeparatorClass, className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue
}
