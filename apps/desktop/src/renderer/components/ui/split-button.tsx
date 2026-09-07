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

import React, { useState } from 'react'
import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { menuActionItemClass } from './menu-variants'
import { Anthropicon } from '../icons'
import { cn } from '../../lib/cn'

interface SplitButtonAction {
  label: string
  onClick: () => void
}

interface SplitButtonProps {
  primaryLabel: string
  primaryAction: () => void
  actions: SplitButtonAction[]
  disabled?: boolean
  size?: 'sm' | 'lg' | 'default'
  variant?: 'default' | 'ghost' | 'outline'
  primaryIcon?: React.ReactNode
  showPrimaryIcon?: boolean
}

export default function SplitButton({
  primaryLabel,
  primaryAction,
  actions,
  disabled = false,
  // 分割按钮是一颗 field 控件,走标准控件高(桌面 32/text-sm)。
  //
  // 原来默认是 'sm' 并额外糊一层 `h-8 text-xs` 的尺寸表 —— 那层表只压得住 `h-8`,
  // 压不住 sm 自带的 `md:h-7`(响应式变体 twMerge 覆盖不掉),桌面端实际是 28 高、
  // 12px 字,比旁边 32 高的控件矮一档。尺寸表整个删掉,高度交给 Button 的 size。
  size = 'default',
  // 默认从 ghost 换成 outline:原来是 ghost(透明)外面再手写一圈
  // border-border-dark/30 凑出描边。outline 在新体系里就是 field 外观
  // ——填充 + 1px 内嵌描边,自带按压回弹,不用手画。
  variant = 'outline',
  primaryIcon,
  showPrimaryIcon = false
}: SplitButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  // 如果没有actions，只显示普通按钮
  if (!actions || actions.length === 0) {
    return (
      <Button
        variant={variant}
        size={size}
        onClick={primaryAction}
        disabled={disabled}
        className="min-w-16 gap-2 px-3"
      >
        {showPrimaryIcon && primaryIcon ? (
          <span className="flex items-center justify-center w-full">
            {primaryIcon}
          </span>
        ) : (
          primaryLabel
        )}
      </Button>
    )
  }

  return (
    // 两半各自是一颗完整的 field 控件(secondary = 填充 + 1px 内嵌描边),
    // 靠右半的 -ml-px 把两圈描边叠在一起,接缝才是一条线而不是两条。
    // 不要改成"外面套一层描边、里面放两颗 ghost":那样按下去没有回弹反馈,
    // squish 的填充层是透明的,缩了也看不见。
    <div className="flex items-center">
      {/* 主按钮 */}
      <Button
        variant={variant}
        size={size}
        onClick={primaryAction}
        disabled={disabled}
        className="min-w-16 gap-2 rounded-r-none px-3"
      >
        {showPrimaryIcon && primaryIcon ? (
          <span className="flex items-center justify-center w-full">
            {primaryIcon}
          </span>
        ) : (
          primaryLabel
        )}
      </Button>

      {/* 下拉按钮 */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          {/* 副键是**正方**的:主键多高它就多宽(桌面 32),不是比主键窄一圈的 28。
              caret 也是 16 不是 12 —— 12 在 32 的键里小得像个瑕疵。 */}
          <Button
            variant={variant}
            size={size}
            disabled={disabled}
            className="-ml-px aspect-square rounded-l-none px-0"
            aria-label="More actions"
          >
            {/* caret 压到 muted:它是"还有别的选择"的提示,不该和主键文案抢注意 */}
            <Anthropicon name="caretDown" size={16} className="text-text-muted" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={4}
        >
          <div className="flex flex-col min-w-[100px]">
            {actions.map((action, index) => (
              <button
                key={index}
                onClick={() => {
                  action.onClick()
                  setIsOpen(false)
                }}
                className={cn(menuActionItemClass, 'whitespace-nowrap')}
              >
                {action.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}