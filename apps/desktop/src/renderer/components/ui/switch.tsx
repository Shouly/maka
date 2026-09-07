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

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "../../lib/cn"

interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  size?: 'sm' | 'default'
}

/**
 * 开关。几何来自 CDS 自己的公式(读 claude.ai 的 switch 类名实测):
 *
 *   --cds-switch-h: 20px / 18px   轨道高就是这一个数(default / sm 两档)
 *   宽   = h × 1.8   → 36 / 32.4
 *   内边距 2px
 *   滑块 = h − 4     → 16 / 14
 *   开态位移 = h × 0.8 → 16 / 14.4
 *
 * 关态轨道 20% 黑(--alpha-3),hover 35%(--alpha-4);开态 --fill-accent
 * (= CDS fill-accent,实测同为 #2a78d6),hover --fill-accent-hover。
 *
 * 关态**不用描边**:原来是 bg-secondary(#e8e6dc 暖米)+ 0.5px ring,在浅底上
 * 轨道本体几乎看不见,全靠那圈 ring 撑出形状。改成实心 alpha 后形状自己成立。
 */
const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, size = 'default', ...props }, ref) => {
  // 两档都是把上面那条公式代进去。! sm 的 h 是 **18 不是 16**。
  const sizeClasses = {
    sm: {
      root: "h-[18px] w-[32.4px]",
      thumb: "size-3.5 data-[state=checked]:translate-x-[14.4px] data-[state=unchecked]:translate-x-0",
    },
    default: {
      root: "h-5 w-9",
      thumb: "size-4 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
    },
  }

  const sizes = sizeClasses[size]

  return (
    <SwitchPrimitives.Root
      className={cn(
        "group/switch peer inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 outline-none transition-colors",
        // 变体顺序:状态在前、hover 在后(与 Cowork 的 data-[checked]:hover: 一致)。
        // 反过来写 hover:data-[state=...] 特异性相同但排序更靠前,会被后面的
        // 静止态规则盖掉 —— hover 就完全不生效。
        "data-[state=unchecked]:bg-alpha-3 data-[state=unchecked]:hover:bg-alpha-4",
        "data-[state=checked]:bg-accent-fill data-[state=checked]:hover:bg-accent-fill-hover",
        // 禁用态取消 hover,否则鼠标移上去仍会变色
        "disabled:hover:bg-alpha-3 data-[state=checked]:disabled:hover:bg-accent-fill",
        "focus-visible:shadow-[var(--sidebar-focus-shadow)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sizes.root,
        className
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          // 回弹缓动取自 Cowork 的 knob(ease-overshoot)。
          // ! 投影别写成 Tailwind 的 shadow-sm:同名两仓不同值,上游那一组
          //   就是本仓的 --card-shadow。
          "pointer-events-none block rounded-full bg-surface-2 shadow-[var(--card-shadow)] transition-transform duration-200 ease-[cubic-bezier(.2,1.3,.6,1)]",
          sizes.thumb
        )}
      />
    </SwitchPrimitives.Root>
  )
})
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
