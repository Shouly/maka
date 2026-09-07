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
 * 状态芯片(schedule 的"每天 9:00"/"Paused" 这类)。
 *
 * 几何取自 Claude scheduled-task 列表实测:高 18 · 左右 6 · r4.5 · 11px/500 ·
 * 图文间距 4。**没有描边** —— 只有一层淡底,描边会让它在卡里显得比标题还重。
 */
export const statusChipClass =
  'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4.5px] px-1.5 text-[11px] font-medium leading-tight';

/** 生效中。底走 --bg-success(CDS green-100),不是 --success 压透明度。 */
export const statusChipSuccessClass = 'bg-success-subtle text-success';

/**
 * 中性(暂停、角色标记这类)。底走 alpha-1 —— CDS 的 --cds-bg-neutral 就是
 * alpha-1(实测),不是某个实心灰;字色是按 CDS 的配对推的,没有实测对照。
 */
export const statusChipNeutralClass = 'bg-alpha-1 text-text-secondary';

/** 强调(Public 这类)。CDS --cds-bg-accent / --cds-text-accent。 */
export const statusChipAccentClass = 'bg-accent-subtle text-accent';

/** 出错。同样走 --bg-danger 这层淡底,不要 danger-fill 压透明度。 */
export const statusChipDangerClass = 'bg-danger-subtle text-danger';

/**
 * 大一档的芯片。Claude 的 scheduled-task **详情页**用的是这一档,列表页才是
 * 上面那档 —— 实测两处确实不同:
 *
 *              高   圆角   字号   左右   图文距   描边
 *   列表(小)   18   4.5    11     6      4        无
 *   详情(大)   22   6      12     6      6        0.5px,取字色 40%
 *
 * 有意思的是它俩在 Claude 源码里用的是**同一个类名** `text-caption` —— 只是
 * 两个作用域把它分别解析成了 11 和 12。所以别拿类名反推像素。
 */
export const statusChipLargeClass =
  'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md border-[0.5px] border-current/40 px-1.5 text-[12px] font-medium leading-[17px]';

/**
 * 图标槽。Claude 实测:图标**画 16px、只占 12px** —— 靠 flex 居中往四周各溢出
 * 2px,再用负外边距把它拽到贴近芯片左沿(它的算式是 (18-12)/2 - 6 + 1 = -2)。
 *
 * 12 是占位尺寸,不是视觉尺寸。直接塞一颗 12px 的图标会明显偏小,而放一颗
 * 不套槽的 16px 又会把芯片撑宽 4px —— 两件事得分开。
 */
export const statusChipIconSlotClass =
  'inline-flex size-3 shrink-0 items-center justify-center -ml-0.5 -mr-[0.8px]';

/** 大档的图标槽:同样是 16 画在 12 里,但**不带负边距**(实测就是不带)。 */
export const statusChipLargeIconSlotClass =
  'inline-flex size-3 shrink-0 items-center justify-center';

/** 槽里那颗图标的字号(视觉尺寸)。 */
export const STATUS_CHIP_ICON_SIZE = 16;
