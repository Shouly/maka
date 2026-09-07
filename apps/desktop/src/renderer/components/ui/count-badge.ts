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
 * 计数丸 —— 未读数、@提及数、新文件数这类"贴在行尾/图标肩上的数字"。
 *
 * 收敛前全仓 9 处各写各的。**16(侧栏) / 20(列表·浮标) 两档本身是对的**:
 * 侧栏密、列表松,单聊那半边也是同样分档,密度不同就该分档。问题在同一档
 * 里字不统一 —— 侧栏 @提及是 11px/580,紧挨着的未读是 10px/500,两颗同高
 * 同宽同圆角的丸子字却差一号加一档字重。列表页那两颗本来就是一致的
 * 11px/500,所以"同档同字、颜色负责区分语义、字重不参与"才是本仓的答案。
 *
 * 三条硬约束,别在调用处就地省掉:
 *
 *  · **tabular-nums** —— 未读数是全站最会跳的数字(1→7→11 实时变),比例
 *    数字会让丸子宽度跟着抖。仓库对这条有明文约定(`Reactions.tsx` 和
 *    `task-sidebar/TaskItemRow.tsx` 都专门留了注释),收敛前 9 处只有
 *    `ChatDispatchTasks` 一处守住。
 *
 *  · **formatCount** —— 99+ 截断。收敛前单聊三处做了、群聊四处一处没做;
 *    群里刷两百条,侧栏那颗丸会撑成一条横杠把会话标题挤没。
 *
 *  · **min-w == h** —— 个位数是正圆,两位数才拉成胶囊。少了 min-w 会得到
 *    一个比高还窄的椭圆。
 *
 * 第三档是**图标肩章**(countBadgeShoulderClass):压在图标右上肩上的那种,
 * 几何受图标尺寸约束、不受行密度约束,所以单独成档而不是塞进 16/20。
 *
 * 有意**不**并进任何一档的两个近亲:
 *
 *  · `ChatAgentsIndicator` 的 12px 肩章:那颗的 12px + 1.5px 底色描边是实测
 *    调过的(原来是 14px + 负偏移,悬在 32 键的角外),见那边的长注释。它的
 *    截断也只能到 `9+` —— 12px 塞不下三个字符。强行并档等于推翻那次调整。
 *
 *  · `SidebarScheduledSection` 的 "3 new" 是**文字**徽标,不是计数丸 ——
 *    不该有 min-width,也不该是正圆。
 *
 */

const BASE =
  'inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none tabular-nums'

/** 侧栏行尾。16px 高。 */
export const countBadgeClass = `${BASE} h-[16px] min-w-[16px] px-1 text-[10px]`

/** 列表页行尾 + 滚到底浮标。20px 高。 */
export const countBadgeLargeClass = `${BASE} h-[20px] min-w-[20px] px-1.5 text-[11px]`

/**
 * 图标肩章。15px 高、9px 字。
 *
 * 配色和其它两档一样走 `countBadgeAccentClass`(实底白字)。收敛前
 * `KnowledgeHub` 那颗是 `bg-accent-subtle text-accent`(淡底深字)+ semibold,
 * 是全仓 13 颗计数丸里唯一的淡底档 —— 同一个部件在一个应用里不该有两种
 * 底色语言,统一到实底。
 */
export const countBadgeShoulderClass = `${BASE} h-[15px] min-w-[15px] px-1 text-[9px]`

/** 未读:体系主色。 */
export const countBadgeAccentClass = 'bg-accent-fill text-on-accent'

/**
 * @提及:warning 族。明暗同色,黑字压琥珀 10.73:1;和相邻蓝丸的亮度差
 * 2.41:1(原来手写的绿丸浅色下只有 1.14:1,色觉受限基本分不出)。
 */
export const countBadgeMentionClass = 'bg-warning-fill text-on-warning'

/**
 * 带字形前缀的变体(新文件丸)。附加在尺寸类之后。
 *
 * 为什么需要:侧栏一行最多同时挂三颗丸 `[@2][7][3]`,而未读和新文件原来
 * **同色同形同尺寸**,唯一区分是 `title` 悬停提示。同一行里 @提及已经示范
 * 了正解 —— 用字形前缀而不是再发明一种颜色。
 *
 * ! 必须用 `cn()` 组合(`cn = twMerge(clsx(...))`),别用字符串拼接:这一档靠
 * twMerge 的"后者胜"把 `px-1.5` 盖掉尺寸档里的 `px-1`。裸拼两个 padding 都会
 * 落到 class 上,最终哪个生效由 Tailwind 生成的 CSS 顺序决定,不由这里决定。
 */
export const countBadgeWithGlyphClass = 'gap-0.5 px-1.5'

/** 超过两位数截断。见上面"硬约束"第二条。 */
export const formatCount = (n: number): string => (n > 99 ? '99+' : String(n))
