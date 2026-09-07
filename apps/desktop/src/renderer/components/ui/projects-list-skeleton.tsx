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
 * Projects 列表页骨架屏。几何跟真卡走同一个 listCardSurfaceClass,别再手抄。
 *
 * 填充色用 bg-skeleton(--skeleton-fill,实测那档),不要用 --secondary —— 那个是米色
 * #E8E6DC,比骨架该有的深一大截。整卡按行往下淡出,替代原先给每张卡单独调
 * 描边透明度的做法(现在卡没有描边,只有一圈 ring)。
 */

import { cn } from '../../lib/cn'
import { listCardSurfaceClass } from './card-surface'

// 每张卡:[标题宽度, 整卡透明度]。透明度必须是字面量,Tailwind 扫不到拼接出来的类名。
const CARD_CONFIGS = [
  ['w-3/4', 'opacity-100'],
  ['w-2/3', 'opacity-90'],
  ['w-1/2', 'opacity-75'],
  ['w-3/5', 'opacity-60'],
  ['w-2/3', 'opacity-45'],
  ['w-1/2', 'opacity-30'],
  ['w-3/5', 'opacity-20'],
  ['w-1/2', 'opacity-10'],
] as const

const barClass = 'rounded-md bg-skeleton animate-pulse'

export function ProjectsListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
      {CARD_CONFIGS.map(([titleWidth, cardOpacity], index) => (
        <div key={index} className={cn(listCardSurfaceClass, cardOpacity)}>
          {/* 标题行 20px,与真卡的 leading-5 对齐 */}
          <div className="flex h-5 items-center">
            <div className={cn(barClass, 'h-4', titleWidth)} />
          </div>

          {/* 描述:两行 + mb-4,和真卡的 listCardDescClass 同一套留白 */}
          <div className="mb-4 space-y-1">
            <div className={cn(barClass, 'h-4 w-full')} />
            <div className={cn(barClass, 'h-4 w-5/6')} />
          </div>

          {/* 页脚 17px */}
          <div className="mt-auto flex h-[17px] items-center">
            <div className={cn(barClass, 'h-3 w-28')} />
          </div>
        </div>
      ))}
    </div>
  )
}
