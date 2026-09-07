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
 * 分栏拖拽把手。侧栏↔正文、正文↔右侧预览共用同一颗。
 *
 * 实测上游两处把手结构完全一致，我们这边原本却是两套：侧栏是这个握把形态，
 * 右侧预览是 `absolute inset-y-0 w-[0.5px] bg-border` 一条通高细线 —— 同一个
 * 交互长着两张脸。抽出来后两边同源。
 *
 * 三层结构，缺一不可：
 *   命中区   w-3 通高、`touch-none`（不写的话移动端拖拽会被页面滚动抢走）
 *   焦点环   单独一层 rounded-full，只在 focus-visible 时亮
 *   握把     3×48 圆角短条，居中，静止不可见、hover 才浮现
 *
 * ! 握把用 `max-h-12` 而不是 `h-12`：聚焦时要能撑成通高（`max-h-none`），
 * 用固定高度就没法从 48 长到满高。
 */

import { cn } from '../../lib/cn'

export interface PaneResizerProps {
  /** 把手贴在哪一侧的容器边缘。left = 面板左缘（正文↔预览）。 */
  side?: 'left' | 'right'
  /** 拖拽中：握把常驻、去掉延迟、**加深一档**（muted → secondary）。 */
  isResizing?: boolean
  ariaLabel: string
  ariaControls?: string
  valueMin?: number
  valueMax?: number
  valueNow?: number
  valueText?: string
  className?: string
  // 两套指针事件都放行:侧栏走 Pointer Events(带捕获),右侧预览目前还是
  // mouse/touch 一套。统一到 Pointer 是另一件事,不塞进这次改造。
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel?: (e: React.PointerEvent<HTMLDivElement>) => void
  onLostPointerCapture?: (e: React.PointerEvent<HTMLDivElement>) => void
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
}

export function PaneResizer({
  side = 'left',
  isResizing = false,
  ariaLabel,
  ariaControls,
  valueMin,
  valueMax,
  valueNow,
  valueText,
  className,
  ...handlers
}: PaneResizerProps) {
  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-controls={ariaControls}
      aria-orientation="vertical"
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      aria-valuetext={valueText}
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      {...handlers}
      className={cn(
        'group/resize absolute inset-y-0 z-30 hidden w-3 touch-none cursor-col-resize outline-none md:block',
        side === 'left' ? '-left-[6px]' : '-right-[6px]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 rounded-full transition-shadow duration-[60ms] group-focus-visible/resize:shadow-[var(--sidebar-focus-shadow)]"
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 h-full max-h-12 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sidebar-text-muted opacity-0 transition-[opacity,background-color,max-height] delay-200 duration-200 group-hover/resize:opacity-100 group-focus-visible/resize:max-h-none group-focus-visible/resize:bg-accent-fill group-focus-visible/resize:opacity-100 group-focus-visible/resize:delay-0',
          isResizing && 'max-h-12 bg-sidebar-text-secondary opacity-100 delay-0 transition-none',
        )}
      />
    </div>
  )
}
