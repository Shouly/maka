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

import { mainHeaderTextLabelClass } from '../layout/MainHeader';

/**
 * 会话首屏骨架。
 *
 * 正文部分按 claude.ai 的 `[data-testid="transcript-list"]` 实测结构复刻:
 * 一个 `animate-pulse` 容器 + `gap-8` 分成"用户气泡"和"助手段落"两块,段落块
 * 内 `gap-2 px-2`,十根 h-4 占位条按 opacity 100→10 均匀递减。
 *
 * 三个容易写错的点:
 *
 *  1. 填充是 --cds-neutral-30(#f6f6f4),不是 alpha 阶梯。CDS 里另有一对
 *     --cds-skeleton-base/-sheen = 10%,但 transcript 骨架没用它 —— 10% 那档
 *     (#e4e4e3)明显更深,写上去整片会压得很实。
 *  2. animate-pulse 挂在**容器**上,不是每根条各挂一个:同一条时间线才会整体
 *     同呼吸,逐条挂会因为各自的动画起点不同而看起来在闪。
 *  3. 宽度用十二分制(w-11/12 …),不是任意百分比 —— 抄的是 Claude 那组节奏。
 *
 * 另外它是在 chats/[id]/page.tsx 里**提前 return** 的,不在真实那棵 .chat-area
 * 树里,所以几何得自己带齐,否则骨架消失那一帧会整体位移:
 *
 *  - 根节点带 `chat-area`,拿到该 scope 下的变量;
 *  - header 用 `h-12` + `app-header-sidebar-clearance`,与 MainHeader 同一套。
 *    少了 clearance,侧栏收起时标题占位会贴最左,真 header 一来往右跳 56px;
 *  - 正文用 `chat-feed`,宽度由 CSS 的 --chat-content-max 给,不要硬编码。
 */

/** opacity 100→10,每档降 10;宽度节奏照抄 claude.ai。 */
const ASSISTANT_LINES = [
  { width: 'w-11/12', opacity: 'opacity-100' },
  { width: 'w-10/12', opacity: 'opacity-90' },
  { width: 'w-11/12', opacity: 'opacity-80' },
  { width: 'w-9/12', opacity: 'opacity-70' },
  { width: 'w-10/12', opacity: 'opacity-60' },
  { width: 'w-11/12', opacity: 'opacity-50' },
  { width: 'w-8/12', opacity: 'opacity-40' },
  { width: 'w-10/12', opacity: 'opacity-30' },
  { width: 'w-9/12', opacity: 'opacity-20' },
  { width: 'w-4/12', opacity: 'opacity-10' },
] as const;

export function ChatSkeleton() {
  return (
    <div className="chat-area flex h-full w-full flex-col" aria-hidden="true">
      {/* Header —— 与 MainHeader 同高同内距 */}
      <header className="h-12 shrink-0 bg-surface-1">
        <div className="app-header-sidebar-clearance flex h-full min-w-0 items-center gap-3 pl-2 pr-3 md:pl-4">
          {/* 占位条要套在 mainHeaderTextLabelClass 里,不能直接贴着行内边距:
              真标题是个 h-7 控件,自带 px-2.5,文字实际从行左 +26px 起。裸放
              占位条就停在 +16px,骨架一消失标题往右挪 10px。复用同一个类而不是
              补个 pl-2.5,是为了 header 几何以后再调时这里跟着走。 */}
          <div className={mainHeaderTextLabelClass}>
            <div className="h-4 w-32 rounded-md bg-skeleton" />
          </div>
        </div>
      </header>

      {/* 消息区 —— 与 page.tsx 里包住 ChatMessages 的那层一致 */}
      <div className="flex flex-1 flex-col overflow-hidden md:px-2">
        <div className="chat-feed px-4 pt-4 pb-8">
          <div className="flex animate-pulse flex-col gap-8">
            {/* 用户气泡:右对齐。h-[46px] 是 Claude 的实测值(15/20 正文 +
                上下 12.5px 内距),不是 h-10。 */}
            <div className="flex justify-end">
              <div className="h-[46px] w-48 rounded-xl bg-skeleton px-4 py-2.5" />
            </div>

            {/* 助手正文:十行渐隐 */}
            <div className="flex flex-col gap-2 px-2">
              {ASSISTANT_LINES.map((line, i) => (
                <div
                  key={i}
                  className={`h-4 rounded-md bg-skeleton ${line.width} ${line.opacity}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
