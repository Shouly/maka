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
 * 卡片表面。Directory / MCP 市场 / 插件列表用的是**同一种卡**,之前三处各自
 * 手抄,改一处就漂一处 —— 和 Input/Textarea 抄 field 样式是同一个毛病,
 * 处理方式也一样:抽成常量,谁用谁 import。
 *
 * 几何取自 Cowork 实测:r16 · 0.5px 描边 · 白底 · 两层浅投影 · 内边距 16 · 行距 12。
 *
 * 内边距**不在 surface 上**:卡片整块可点时,可点区是里面那颗铺满的 button,
 * padding 得由它拿着,否则边上一圈 16px 点不动。所以 surface 和 body 分开。
 */
export const cardSurfaceClass =
  'rounded-2xl border border-hairline bg-surface-3 shadow-[var(--card-shadow)] transition-all duration-200';

/**
 * hover:描边加深一档,投影**换成**更远更散的一层(不是在静止态上叠加)。
 *
 * ! `border-border-strong` 的双 border 前缀不是笔误,别"顺手"删成
 * `border-strong`。token 名就叫 `--color-border-strong`,Tailwind 据此生成的
 * 颜色名是 `border-strong`,拼到 border 工具类上就成了 `border-border-strong`
 * ——和全仓 230 处 `border-border-dark` 同一个道理。写成 `border-strong` 不匹配
 * 任何颜色,Tailwind 不生成规则、也不报错,浏览器静默回退到 currentColor(浅色
 * 主题下是近黑的 #141413),描边会比预期深一大截,而且只在 hover 时才露出来。
 */
export const cardSurfaceHoverClass =
  'hover:border-border-strong hover:shadow-[var(--card-shadow-hover)]';

/** 卡内容的排布。真卡的 button 与 skeleton 共用,免得两者长歪。 */
export const cardBodyClass = 'flex h-full flex-col gap-3 p-4';

/* ------------------------------------------------------------------ *
 * 列表页卡片(projects / agents / knowledge bases / schedules / ...)
 *
 * 和上面那套**不是一种卡**,别混:上面是插件/市场卡(r16 · 白底 · 两层投影),
 * 这套没有投影也没有 border,轮廓是一圈内嵌 1px ring,hover 只换填充。
 * 几何取自 Cowork projects 列表实测:r12 · padding 16 · gap 8 · ring 10%。
 * ------------------------------------------------------------------ */

/**
 * ring 走 box-shadow 而不是 border:border 占布局盒,卡是 h-full 撑满网格行的,
 * 多出的 2px 会挤掉内容;ring 不占位。focus-visible 直接**换掉**这层 ring,所以
 * 两者不会叠在一起。
 *
 * 底色和页面同为 surface-1 —— 这不是漏改,Cowork 的 body 与卡都是 surface-1,
 * 卡靠 ring 立住,hover 才升到 surface-2。也没有过渡:实测就是瞬时切换。
 *
 * ! 深色下 hover 的方向和 Claude 相反:CDS 的深色 surface 阶梯是越往上越亮
 * (850 #151515 → 830 #1a1a19),我们的是 surface-1 #262624 → surface-2 #201f1a,
 * 越往上越暗。这里仍然写 surface-2 而不是就地换个更亮的色:角色是对的,等深色
 * 阶梯整体校准后这张卡会自动跟上。
 */
// 字号压在卡上(而不是只压在每个子元素上):否则卡内任何没显式带 text-sm 的
// 文字都会继承页面的 16px。Cowork 的卡本身就带 text-body。
export const listCardSurfaceClass =
  'flex h-full w-full flex-col gap-2 rounded-xl bg-surface-1 p-4 text-sm leading-5 shadow-[inset_0_0_0_1px_var(--hairline)]';

/** 可点的卡。骨架屏用上面那个静态版,免得骨架也跟着 hover 变色。 */
export const listCardClass = `${listCardSurfaceClass} outline-none hover:bg-surface-2 focus-visible:shadow-[var(--sidebar-focus-shadow)]`;

/** 卡外壳:hover 组的锚点、⋯ 的定位基准、按下时整卡回弹。 */
export const listCardShellClass =
  'group relative h-full transition-transform duration-200 ease-[cubic-bezier(.165,.84,.44,1)] has-[a:active]:scale-[0.98] has-[a:active]:duration-[var(--dur-fast)]';

/**
 * ⋯ 槽位。纯 CSS 浮现,别再拿 isHovered/isMenuActive 两个 state 驱动 —— 那会让
 * 每张卡在指针经过时重渲染一次。菜单展开中靠 Radix 写的 aria-expanded 保持可见。
 */
export const listCardActionsSlotClass =
  'absolute right-3 top-3 opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 has-[[aria-expanded=true]]:opacity-100';

/** pr-10 是给 ⋯ 让位:它 32px 宽、距右 12px,吃掉内容区 28px。 */
export const listCardTitleRowClass = 'flex items-center gap-2 overflow-hidden pr-10';

export const listCardTitleClass = 'truncate text-sm font-medium leading-5 text-text-primary';

/** 描述为空时**不要渲染这个元素**:Cowork 的无描述卡直接塌到 77px,不留空行。 */
export const listCardDescClass = 'mb-4 line-clamp-3 text-sm leading-5 text-text-secondary';

/** 13px/17 这档 Tailwind 没有,对应 CDS 的 text-footnote。 */
export const listCardFooterClass =
  'mt-auto flex items-center justify-between text-[13px] leading-[17px] text-text-muted';

/* ------------------------------------------------------------------ *
 * 带缩略图的列表卡(files)。几何取自 Claude artifacts 列表实测。
 *
 * 是上面那张纯文字列表卡的**另一档**,不是另一种卡:同样 r12、同样 1px ring、
 * 同样没有投影、按下同样回弹 0.98。差别只在它顶着一块缩略图,所以:
 *   - 从 surface-2 起步,hover **往回落**到 surface-1 —— 方向和纯文字卡相反
 *   - ring 画在 ::after 上而不是自身 box-shadow:卡是 overflow-hidden 的,
 *     缩略图铺满到边会盖住内嵌 ring,::after 浮在内容之上才压得住
 * ------------------------------------------------------------------ */

export const mediaCardSurfaceClass =
  'relative flex h-full flex-col overflow-hidden rounded-xl bg-surface-2 text-sm leading-5 group-hover:bg-surface-1 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--hairline)] after:content-[""]';

/** 缩略图区。**定高 160**,不是 aspect-*。 */
export const mediaCardThumbClass = 'relative h-[160px] select-none overflow-hidden';

/** 缩略图与信息区之间的分隔线。mx-px 让它不压到卡的 ring 上;1px 是实测值。 */
export const mediaCardDividerClass = 'mx-px border-t-[1px] border-alpha-1';

export const mediaCardBodyClass = 'flex flex-1 flex-col gap-2 p-3.5';

/** 12/17 = CDS text-caption,比纯文字卡页脚的 13/17 再小一档。 */
export const mediaCardMetaClass =
  'mt-auto flex items-center gap-1 text-[12px] leading-[17px] text-text-muted';
