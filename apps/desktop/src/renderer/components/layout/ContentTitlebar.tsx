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

// The content column's titlebar row (plan §2.12): the session identity on
// the left, right-side actions (model switcher, later the workbar toggle) on
// the right, under the same 36px strip the sidebar's row occupies. When the
// sidebar is collapsed the row also clears the collapsed rail that now sits
// over its left edge. On Windows the right gutter clears the caption buttons.

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export function ContentTitlebar(props: {
  identity?: ReactNode;
  actions?: ReactNode;
  sidebarCollapsed: boolean;
}) {
  return (
    <div
      className={cn(
        'maka-titlebar-row maka-titlebar-gutter-right maka-content-titlebar flex shrink-0 items-center gap-2',
        props.sidebarCollapsed ? 'maka-content-titlebar-clears-rail' : 'pl-3',
      )}
      data-sidebar-collapsed={props.sidebarCollapsed ? 'true' : 'false'}
    >
      <div className="flex min-w-0 flex-1 items-center">{props.identity}</div>
      <div className="maka-no-drag flex shrink-0 items-center gap-0.5">{props.actions}</div>
    </div>
  );
}
