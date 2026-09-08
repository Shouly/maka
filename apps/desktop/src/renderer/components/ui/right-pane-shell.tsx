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
 * 右侧预览面板的外壳。文件预览 / 浏览器预览 / NocoBase 预览共用。
 *
 * 形态取自上游实测（视口 1512、面板 600 宽时）：
 *
 *   面板   x=894 y=8 w=610 h=761 · r10 · surface-3 白底 · overflow-hidden
 *          → 上下右各留 8px 檐，不是占满到屏幕边
 *   三层影 1px 描边环(10%) + 0 1px 2px(6%) + 0 2px 8px(8%)，见 --pane-shadow
 *          border-width 实测是 0 —— 那圈线是 box-shadow 画的，不是真 border
 *   header 面板自带 48px，不复用正文那条
 *   把手   x=896 w=8，贴在面板左缘外侧
 *
 * 和 TaskSidebar 的 `md:pt-2 md:pr-2 md:pb-2` 是同一个 8px 节奏 —— 两者本来
 * 就该长一样，之前预览是占满右半屏 + 一条通高细线，和它不是一个物种。
 *
 * ! 檐是 padding 不是 margin：宽度由外部按百分比控制，用 margin 会让实际
 * 内容宽比设定值少 16px，拖到最小宽时对不上 minWidth 的约束。
 *
 * ! 外层必须 `z-20`（上游实测也是 20）。那圈描边是 box-shadow 画在**盒子外面**
 * 的，会有 1px 落进左边聊天栏那一列；而 MainHeader 底下挂着一条 `z-10` 的渐隐条
 * (inset-x-0 h-6)，横向铺满聊天栏。外层不抬层级的话，渐隐条会盖住描边最上面那
 * 24px，左缘看着像从 header 底缘开始缺了一块。
 *
 * 展开态（全屏）实测，视口 1512：
 *
 *   进全屏后  侧栏被收起，面板 1512×777 @0，header 首位是"展开侧栏"键(8..40)、
 *             其后内容从 48 起
 *   点开侧栏  面板缩到 1224×777 @288，侧栏正常可见，按钮仍是 Collapse ——
 *             **不退出全屏**
 *
 * 所以全屏铺的是「侧栏右边的那块」而不是整个窗口：进来时顺手收起侧栏，但用户
 * 随时可以把它请回来，面板跟着让位。侧栏的联动写在 uiStore.setRightPaneExpanded。
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Anthropicon } from '../icons';
import { Button } from './button';
import { PaneResizer, type PaneResizerProps } from './pane-resizer';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { useUiLocale } from '@maka/ui';
import { getWorkbarCopy } from '../../locales/workbar-copy';

interface RightPaneContextValue {
  isExpanded: boolean;
  /** 不在外壳里时为 null —— 展开按钮据此自行隐藏，而不是抛错。 */
  toggleExpanded: (() => void) | null;
}

const RightPaneContext = createContext<RightPaneContextValue>({
  isExpanded: false,
  toggleExpanded: null,
});

/** 面板内部读展开态。外壳之外调用会拿到一个不可展开的空实现。 */
export function useRightPane() {
  return useContext(RightPaneContext);
}

export interface RightPaneShellProps {
  children: ReactNode;
  /**
   * 全屏态。参照实现把它放在 uiStore 里(侧栏要据此把浮动开关交给面板 header);
   * Maka 的面板由 workbar 布局拥有,所以外壳只做受控组件 —— 状态和联动都在调用方,
   * 外壳既不持有也不在卸载时归零。不传 `onExpandedChange` 即不可展开,
   * `RightPaneExpandButton` 据此自行隐藏。
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /**
   * 面板宽度。不传则 `flex-1` 吃掉剩余空间 —— 单聊那边是「正文带百分比宽、
   * 预览吃剩下」的排法，宽度不在这一侧。
   */
  width?: string;
  /** 最小宽度，防止拖到看不见。只在显式给 width 时有意义。 */
  minWidth?: string;
  /** 拖拽把手。不传则面板不可拖。 */
  resizer?: PaneResizerProps;
  className?: string;
  id?: string;
}

export function RightPaneShell({
  children,
  width,
  minWidth = '30%',
  resizer,
  className,
  id,
  expanded = false,
  onExpandedChange,
}: RightPaneShellProps) {
  // 参照实现在 uiStore 里持有全屏态;这里是受控 prop,见 RightPaneShellProps。
  const isExpanded = expanded;
  const toggleExpanded = useMemo(
    () => (onExpandedChange ? () => onExpandedChange(!isExpanded) : null),
    [isExpanded, onExpandedChange],
  );

  // Escape 退出全屏。面板里能开出对话框(发布 artifact / 分享文件),Radix 自己
  // 也监听 Escape —— 两边都响应的话一次 Escape 会同时关掉对话框和全屏。有对话框
  // 开着就让它先接,用户再按一次才退全屏。
  useEffect(() => {
    if (!isExpanded || !onExpandedChange) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      onExpandedChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded, onExpandedChange]);

  const context = useMemo(() => ({ isExpanded, toggleExpanded }), [isExpanded, toggleExpanded]);

  return (
    <RightPaneContext.Provider value={context}>
      {/*
        外层在全屏时去掉 `relative`，把定位基准让给上面最近的定位祖先 ——
        页面那层通栏 div，它和 `<main data-sidebar-main>` 同宽同高。就算哪天
        那层不再是 relative，也会落到 `<main>` 上（AppLayout 已给它 relative），
        两者是同一个框，所以这条链两端都对。

        外层自己仍占着原来的宽度，左边聊天栏不会在全屏底下重排一次（虚拟消息
        列表白白重算一轮）。
      */}
      <div
        className={cn(
          'flex flex-col pb-2 pr-2 pt-2',
          // 移动端盖在内容区上，和 TaskSidebar 那个 aside 同一套坐标（两个聊天页
          // 的根 div 都带 relative，定位基准现成）。留在流里不行：globals.css 那条
          // 给 FilesSidebar 写的 `.chat-area{width:100%!important}` 也砸在这儿，
          // 聊天区吃满宽后面板只剩 0 宽、被挤出屏幕（实测 w=0、x=390）。
          //
          // top-12 而不是 inset-0：那 48px 是 ChatHeader / MainHeader（都是 h-12），
          // 里面装着移动端**唯一**的侧栏开关（SidebarToggleButton 挂 md:hidden）。
          // 盖住它的话，开着预览就换不了会话，只能先关预览。
          // z-30：压住 TaskSidebar(z-10)，让开侧栏抽屉的遮罩(fixed inset-0 z-40)
          // —— 同为 40 时本元素在 DOM 里更靠后会盖住遮罩，抽屉就点不掉了。
          'max-md:absolute max-md:inset-x-0 max-md:top-12 max-md:bottom-0 max-md:z-30 max-md:pl-2',
          // position / z-index / height 每项都只出一条带断点的：同一个属性出两条
          // (一条裸的 + 一条 max-md:)时谁赢取决于 Tailwind 的工具类排序，不能赌。
          // height 尤其要紧：移动端绝对定位下留着裸 h-full 的话，height:100% 会按
          // 容器算成整屏、盖过 bottom-0，面板底部就掉到视口外面(实测 y=48 高 844)。
          'md:h-full md:z-20',
          !isExpanded && 'md:relative',
          width ? 'shrink-0' : 'min-w-0 flex-1',
        )}
        style={width ? { width, minWidth } : undefined}
      >
        {/* 全屏时没有可拖的边；移动端是整屏覆盖，也没有可拖的分栏 */}
        {resizer && !isExpanded && (
          <PaneResizer
            side="left"
            {...resizer}
            className={cn('max-md:hidden', resizer.className)}
          />
        )}
        {/*
          全屏铺满「侧栏右边的那块」，不是铺满窗口 —— 侧栏进出时那块变宽变窄，
          面板跟着走，和上游一致。

          ! 不要改成 portal 到 `<main>`：`createPortal(panel, el)` 和直接渲染
          `panel` 在 React 眼里是两种元素，切换会把整棵子树卸载重建 —— NocoBase
          的 iframe 会重新加载、浏览器预览的 VNC 会重连、视图模式和滚动位置全丢。

          z-40 压在对话框(50)/popover(60)/toast(100)/tooltip(130) 之下 ——
          发布、分享这些都是从面板里点出来的，必须浮在全屏面板之上。
        */}
        <div
          id={id}
          className={cn(
            'flex flex-col overflow-hidden bg-surface-3',
            isExpanded
              ? 'absolute inset-0 z-40'
              : 'min-h-0 flex-1 rounded-[10px] shadow-[var(--pane-shadow)]',
            className,
            // className 里带的是拖宽用的 `transition-[width]`。全屏是瞬时切换，
            // 留着它会让面板从原宽滑到满宽 —— 放在 className 之后才盖得掉。
            isExpanded && 'transition-none',
          )}
        >
          {children}
        </div>
      </div>
    </RightPaneContext.Provider>
  );
}

/**
 * 展开 / 收起键。三个预览的 header 各自摆放，图标和文案在这里统一：
 * 展开用 expand(E067)、已展开用 collapse(E04D)，与上游一致。
 */
export function RightPaneExpandButton() {
  const { isExpanded, toggleExpanded } = useRightPane();
  const pane = getWorkbarCopy(useUiLocale()).pane;
  if (!toggleExpanded) return null;
  const label = isExpanded ? pane.collapse : pane.expand;
  return (
    <RightPaneTip label={label}>
      <Button variant="ghost" size="iconSm" onClick={toggleExpanded} aria-label={label}>
        <Anthropicon name={isExpanded ? 'collapse' : 'expand'} size={20} />
      </Button>
    </RightPaneTip>
  );
}

/**
 * 面板自带的 header。实测 48px = `p-2` 包一排 32 高的控件，横向节奏 gap-2。
 *
 * 底下那条 0.5px 细线不能省：面板正文和 header 同为 surface-3 白底，没有线两块
 * 会糊成一片。上游用 `after:border-b-0.5` 画伪元素，我们直接上真 border ——
 * box-sizing 是 border-box，48 不会被撑成 48.5。
 */
export function RightPaneHeader({
  children,
  className,
  sidebarOpener,
}: {
  children: ReactNode;
  className?: string;
  /**
   * 全屏时寄居在 header 里的「展开侧栏」键。参照实现直接读 uiStore;这里是插槽,
   * 由拥有侧栏状态的调用方(Phase 2/4)决定是否给、给什么。
   */
  sidebarOpener?: ReactNode;
}) {
  return (
    // Provider 放在 header 上而不是让三个预览各自去套：header 里全是纯图标键，
    // 提示是这一条的固有配置，不该由使用方记得加。仓里没有全局 Provider。
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex h-12 shrink-0 select-none items-center gap-2 border-b border-hairline px-2',
          className,
        )}
      >
        {sidebarOpener}
        {children}
      </div>
    </TooltipProvider>
  );
}

/**
 * 全屏时寄居在面板 header 里的「展开侧栏」键(填 RightPaneHeader 的 sidebarOpener)。
 *
 * 全屏面板铺满主区,正好从侧栏右缘开始 —— 侧栏收起时它就顶到窗口左上角,和侧栏
 * 那颗浮动开关撞在一起。参照实现的解法不是让位、也不是把开关删掉,而是把它**搬进
 * header 当第一个元素**(实测 32×32 @8,8,其后内容从 48 起)。点它侧栏进出、面板
 * 跟着缩放,全屏态一直保持 —— 所以侧栏那边在全屏期间不渲染浮动开关,两者是同一颗
 * 键的两个居所,不会同时出现。是否渲染、以及键盘激活后的焦点交接由调用方决定。
 */
export function RightPaneSidebarOpener({ onOpen }: { onOpen: () => void }) {
  const label = getWorkbarCopy(useUiLocale()).pane.openSidebar;
  return (
    <RightPaneTip label={label}>
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpen}
        aria-label={label}
        aria-controls="app-sidebar"
        className="text-sidebar-text-primary"
      >
        <Anthropicon name="sidebar" />
      </Button>
    </RightPaneTip>
  );
}

/**
 * header 图标键的提示气泡。
 *
 * 一律朝下弹 —— header 贴在面板顶缘，朝上会顶出面板外。
 * 别再同时写 `title=`：原生提示会和它一起冒出来，变成两层。
 */
export function RightPaneTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
