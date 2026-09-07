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

import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import * as React from "react"

import { cn } from "../../lib/cn"

function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      {...props}
    />
  )
}

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

/** 默认档:短标签 + 可选快捷键。几何走 --tooltip-* token,别在调用点覆盖。 */
export const tooltipContentClass =
  "ui-tooltip pointer-events-none z-[130] inline-flex min-h-[var(--tooltip-min-height)] max-w-[var(--tooltip-max-width)] select-none items-center gap-[var(--tooltip-gap)] whitespace-normal break-words rounded-tooltip bg-tooltip px-[var(--tooltip-padding-inline)] py-[var(--tooltip-padding-block)] text-[length:var(--tooltip-font-size)] leading-[var(--tooltip-line-height)] font-[number:var(--tooltip-font-weight)] text-tooltip-foreground shadow-tooltip"

/**
 * 描述档:成段说明用。默认档 max-w 只有 240,同一段文案塞进去会变成一根
 * 竖条(实测 240×420 vs 416×158)—— 可能有整段文字的一律用这一档。
 */
export const tooltipDescriptionClass =
  "ui-tooltip pointer-events-none z-[130] block max-w-[var(--tooltip-desc-max-width)] select-none whitespace-normal break-words rounded-tooltip bg-[var(--tooltip-desc-surface)] px-[var(--tooltip-desc-padding-inline)] py-[var(--tooltip-desc-padding-block)] text-[length:var(--tooltip-desc-font-size)] leading-[var(--tooltip-desc-line-height)] font-[number:var(--tooltip-font-weight)] text-[var(--tooltip-desc-foreground)] shadow-[var(--tooltip-desc-shadow)]"

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    variant?: "default" | "description"
  }
>(({ className, sideOffset = 6, variant = "default", ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      data-slot="tooltip-content"
      data-variant={variant}
      className={cn(
        variant === "description" ? tooltipDescriptionClass : tooltipContentClass,
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
