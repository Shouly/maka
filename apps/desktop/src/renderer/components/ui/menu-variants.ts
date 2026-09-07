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

import { cn } from '../../lib/cn';

/**
 * Shared Claude-style menu primitives.
 *
 * Keep these classes in one place so DropdownMenu, sidebar Popovers, and
 * bespoke menu surfaces do not drift apart as their Radix primitives differ.
 */

/**
 * 浮层的三档形态。没有 "default" —— 旧的 `bg-popover` + `border-dark/30`
 * 一档已经全部迁完并删除,新增浮层不该再有第四种长相。
 *
 *  - `menu`:列表型菜单,自带 padding / 最小最大宽度;
 *  - `sidebar`:视觉同 `menu`,额外声明"这个浮层归侧栏所有",收起态悬停预览
 *    靠它判断菜单开着时不要把面板收回去(见 useSidebarPeek);
 *  - `panel`:富内容面板(表单、搜索、网格)。只给表面色、圆角和阴影,
 *    padding / 宽高一律由调用点自己控制,不要在这里塞几何。
 */
export type MenuVariant = 'menu' | 'sidebar' | 'panel';

/**
 * 列表型菜单的浮层容器。
 * ! `max-h` 不能删:只有 `overflow-y-auto` 没有上限,面板永远不出滚动条,
 * 只会长出视口。非 popper 的浮层拿不到这个变量,声明失效退回 none。
 */
export const menuContentClass =
  'z-50 min-w-32 max-w-80 max-h-[var(--radix-popper-available-height)] overflow-hidden overflow-y-auto rounded-xl border-0 bg-menu-surface p-1 text-sm leading-5 font-normal text-menu-text-primary backdrop-blur-none shadow-[var(--menu-shadow)] outline-none';

/** 叠在 menuContentClass 上:根节点交出 padding 和滚动,给 shell 布局用。 */
export const menuShellClass = 'flex flex-col overflow-y-hidden p-0';

/** 富内容面板的浮层容器:与 menu 同一套表面语义,但不预设几何。 */
export const menuPanelClass =
  'z-50 overflow-hidden rounded-2xl border-0 bg-menu-surface text-sm leading-5 text-menu-text-primary backdrop-blur-none shadow-[var(--menu-shadow)] outline-none';

/**
 * Radix 菜单项(DropdownMenuItem / CheckboxItem / RadioItem)。
 *
 * ! 高亮底走 `focus-visible:`,**不要**写成 `focus:`。Radix 的浮层打开时会把
 * 焦点移进去(Popover 落到第一个可聚焦元素、Menu 落到高亮项),用 `focus:` 的话
 * 鼠标点开菜单,第一项立刻带上 hover 底 —— 看着像"默认选中了它"。
 * `focus-visible:` 只在键盘操作时匹配,鼠标打开就不亮;键盘打开照亮不误。
 * Radix 自己的菜单另有 `data-[highlighted]`,不受影响。
 */
export const menuItemClass =
  'group relative flex min-h-8 cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm leading-5 outline-none transition-colors hover:bg-menu-hover focus:outline-none focus-visible:bg-menu-hover disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-menu-hover';

/**
 * 手写 `<button>` 菜单行。Popover 里的菜单不是 Radix 菜单项,没有 indicator
 * 要靠 `justify-between` 推到右边,所以改成左对齐并占满整行。
 */
export const menuActionItemClass = cn(menuItemClass, 'h-8 w-full justify-start text-left');

/** 破坏性菜单项,叠加在 menuItemClass / menuActionItemClass 之上。 */
export const menuDangerItemClass =
  'text-danger hover:!bg-danger-fill hover:!text-on-danger focus:!bg-danger-fill focus:!text-on-danger data-[highlighted]:!bg-danger-fill data-[highlighted]:!text-on-danger';

export const menuSeparatorClass = 'mx-2.5 my-1 h-px bg-menu-hairline';

/**
 * 行尾的"更多操作"触发按钮(⋮)。Cowork 实测:
 *   - 图标默认就是**主色**,不是次要灰 —— 它是常驻操作入口,不该先压暗再靠
 *     hover 提亮
 *   - 32×32 **正方形**(aspect-square + w-control),不靠 padding 凑;放在 flex
 *     行里时 padding 方案会被拉伸成长方形
 *   - hover 与展开态同底:fill-ghost-hover(5%)
 *
 * 全仓 11 个 ActionsMenu 原本各自手抄 `p-1.5 rounded-md hover:bg-accent
 * text-muted-foreground`,改一处等于改不动 —— 统一到这里。
 */
export const menuTriggerButtonClass =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-primary outline-none transition-colors hover:bg-sidebar-menu-hover focus-visible:shadow-[var(--sidebar-focus-shadow)]';

/** 展开态:与 hover 同底。用在调用点的 `isOpen && menuTriggerOpenClass`。 */
export const menuTriggerOpenClass = 'bg-sidebar-menu-hover';

/**
 * 上面那颗是 32×32 · r8 的「更多操作」档;这里是**另一档**:28×28 · r7 的
 * inline 上下文动作(项目页的收藏/成员/编辑说明、右栏面板里的加号……)。
 * Cowork 项目页实测就是这两档并存 —— Unpin/Edit instructions 是 28/r7,
 * 只有 ⋯ 主菜单才 32/r8。
 *
 * 字色同样是 text-primary:常驻入口不先压暗;hover 只加底,不动字色。
 *
 * 注意别用 <Button size="sm"> 凑:它是 `h-8 md:h-7 px-2.5`,md 断点会把高度
 * 拉到 28 而宽度还是 32,出来是个扁的;而且 Button 的填充在 ::before 上,
 * 再叠 hover:bg-* 会把按压反馈盖掉。方形图标按钮目前只能走裸 button。
 */
export const inlineIconButtonClass =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-text-primary outline-none transition-colors hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50';
