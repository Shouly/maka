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
 * 勾选框的方框。全仓原本两处各画各的(侧栏自定义弹框、列表行的选择态),
 * 抽到这里统一。几何取自 CDS Checkbox 实测,两档尺寸:
 *
 *   default  20px · r5   —— data-size 缺省
 *   xs       16px · r4   —— data-size="xs",列表行用这档
 *
 * 状态色两档共用:静止 border-strong(20%) + 透明底,hover 加深到
 * border-stronger(40%),选中换 accent 实心并把描边收成透明。
 *
 * ! border-[1px] 不是笔误:仓库把全局 `border` 工具类改成了 0.5px,勾选框
 * 那一圈那么细基本看不见,这里必须显式写回 1px。
 *
 * hover 态依赖调用点在外层挂 `group/cb`。
 */
import { cn } from '../../lib/cn'

const CHECKBOX_SIZE = {
  default: 'size-5 rounded-[5px]',
  xs: 'size-4 rounded-[4px]',
} as const

export type CheckboxBoxSize = keyof typeof CHECKBOX_SIZE

export function checkboxBoxClass(checked: boolean, size: CheckboxBoxSize = 'default') {
  return cn(
    'flex shrink-0 items-center justify-center border-[1px] transition-colors',
    CHECKBOX_SIZE[size],
    checked
      ? 'border-transparent bg-accent-fill text-on-accent group-hover/cb:bg-accent-fill-hover'
      : 'border-border-strong bg-transparent group-hover/cb:border-border-stronger',
  )
}

/**
 * 勾的字号。xs 档实测是 **16 —— 和方框同尺寸**,勾基本铺满整个框;给成 12 会
 * 明显显小(框里空一圈)。default 档的 16 是沿用改造前的既有值,没有实测对照,
 * 按 xs 的 1:1 关系推该是 20,等量到再说。
 */
export const CHECKBOX_TICK_SIZE = { default: 16, xs: 16 } as const
