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
 * Chats 列表加载骨架屏 - 紧凑单行样式
 * 结构匹配 CompactListRow(ConversationRow / GroupChatRow 共用的行基座):
 * h-8 内容 + py-2 + px-3 + 1px alpha-1 分隔线,加载完成时标题不位移。
 *
 * 填充走 bg-skeleton(--skeleton-fill),整行按 opacity 往下淡出 —— 原先给每行
 * 单独调 bg-secondary 和描边透明度的做法已经作废:secondary 是米色 #E8E6DC,
 * 比骨架该有的深一大截,而分隔线现在也不再是 border-dark。
 */

import { cn } from '../../lib/cn';

interface ChatsListSkeletonProps {
  /** 显示行数，默认 8 */
  count?: number;
}

// [标题宽度, 整行透明度]。透明度必须是字面量,Tailwind 扫不到拼接出来的类名。
const ROW_CONFIGS = [
  ['w-2/5', 'opacity-100'],
  ['w-1/2', 'opacity-90'],
  ['w-1/3', 'opacity-75'],
  ['w-3/5', 'opacity-60'],
  ['w-2/5', 'opacity-45'],
  ['w-1/4', 'opacity-30'],
  ['w-1/5', 'opacity-20'],
  ['w-1/6', 'opacity-10'],
] as const;

const barClass = 'rounded-md bg-skeleton animate-pulse';

export function ChatsListSkeleton({ count = 8 }: ChatsListSkeletonProps) {
  const rowCount = Math.min(count, ROW_CONFIGS.length);

  return (
    <div>
      {Array.from({ length: rowCount }).map((_, index) => {
        const [width, rowOpacity] = ROW_CONFIGS[index];

        return (
          <div
            key={index}
            className={cn(
              'flex h-8 box-content items-center gap-2.5 px-3 py-2 border-alpha-1',
              rowOpacity,
              index < rowCount - 1 && 'border-b-[1px]',
            )}
          >
            {/* 行首 16px 类型 icon 占位 */}
            <div className={cn(barClass, 'size-4 shrink-0 rounded')} />
            <div className={cn(barClass, 'h-4', width)} />
            <div className={cn(barClass, 'ml-auto h-3 w-16 shrink-0')} />
          </div>
        );
      })}
    </div>
  );
}
