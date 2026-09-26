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

// One expanded nav row: button shell, 28px icon slot, label. Ported from the
// reference design system's `SidebarNavButton`; the collapsed sidebar has no
// persistent icon rail, so there is deliberately no collapsed branch.

import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

/** Icons stay visually still; feedback comes from colour and surface. */
export const navIconClass = 'shrink-0';

/** The row itself: 28px tall, r8, secondary text that rises to primary on hover. */
export const sidebarNavButtonClass =
  'group/navbtn flex h-7 w-full cursor-pointer items-center rounded-lg px-[2px] text-sidebar-text-secondary transition-[color,background-color,box-shadow] hover:bg-sidebar-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none';

export function SidebarNavButton(props: {
  icon: ReactNode;
  label: string;
  isActive?: boolean;
  onSelect: () => void;
  /** Right-aligned trailing content: a count badge, a shortcut hint. */
  trailing?: ReactNode;
  /** Unread activity in this destination; absent when everything is read. */
  unreadLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      // Explicit, because the trailing count badge is inside the button.
      aria-label={props.label}
      aria-description={props.unreadLabel}
      aria-current={props.isActive ? 'page' : undefined}
      className={cn(
        sidebarNavButtonClass,
        props.isActive && 'bg-sidebar-selected text-sidebar-text-primary',
        props.className,
      )}
    >
      <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center">{props.icon}</div>
      <span className="min-w-0 flex-1 truncate text-left text-[0.8125rem] leading-5">
        {props.label}
      </span>
      {props.unreadLabel && (
        <span
          aria-hidden="true"
          title={props.unreadLabel}
          className="mr-2 size-1.5 shrink-0 rounded-full bg-accent-fill"
        />
      )}
      {props.trailing}
    </button>
  );
}
