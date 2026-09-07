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

import * as React from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

interface SidebarTooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  /** 只在收起态显示。侧栏已无收起态图标轨,那边一律配合 alwaysShow 使用。 */
  isCollapsed?: boolean;
  alwaysShow?: boolean; // 新增：始终显示tooltip的选项
}

const SidebarTooltipGroupContext = React.createContext(false);

/**
 * 相邻按钮的提示要归到同一个 Provider 才会就地交接;各自成组时旧的退场和新的入场
 * 会重叠成两块黑片。不包也不会坏,SidebarTooltip 会自己兜一个。
 */
export function SidebarTooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <SidebarTooltipGroupContext.Provider value={true}>
      <TooltipProvider delayDuration={300} skipDelayDuration={300}>
        {children}
      </TooltipProvider>
    </SidebarTooltipGroupContext.Provider>
  );
}

export function SidebarTooltip({
  children,
  content,
  side = 'right',
  sideOffset = 6,
  isCollapsed = false,
  alwaysShow = false,
}: SidebarTooltipProps) {
  const hasGroup = React.useContext(SidebarTooltipGroupContext);

  // 如果设置了alwaysShow，则始终显示tooltip
  // 否则只在collapsed状态显示
  if (!alwaysShow && !isCollapsed) {
    return <>{children}</>;
  }

  const tooltip = (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={sideOffset}>
        {content}
      </TooltipContent>
    </Tooltip>
  );

  // Radix 要求必须有 Provider 祖先,没有会抛错。
  return hasGroup ? tooltip : <SidebarTooltipProvider>{tooltip}</SidebarTooltipProvider>;
}
