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

// The primary action at the top of the list. Ported from the reference design
// system's `SidebarNewButton`: the round chip behind the plus is the only
// "primary action" signal in the whole rail, so its geometry is fixed here
// rather than reproduced per call site.

import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';

export function SidebarNewButton(props: {
  label: string;
  onSelect: () => void;
  isActive?: boolean;
  /** Shortcut hint; fades in on hover only. */
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      // Explicit, because the shortcut hint is inside the button and would
      // otherwise become part of the accessible name.
      aria-label={props.label}
      aria-current={props.isActive ? 'page' : undefined}
      className={cn(
        'group/new flex h-8 w-full cursor-pointer items-center rounded-lg px-[2px] text-sidebar-text-secondary transition-[color,background-color,box-shadow] hover:bg-sidebar-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none',
        props.isActive && 'bg-sidebar-selected text-sidebar-text-primary',
      )}
    >
      <div className="mr-2 flex h-8 w-7 shrink-0 items-center justify-center">
        <div
          className={cn(
            'flex size-[22px] items-center justify-center rounded-full transition-colors',
            props.isActive
              ? 'bg-transparent group-hover/new:bg-transparent'
              : 'bg-sidebar-add-chip group-hover/new:bg-sidebar-text-muted/25',
          )}
        >
          <Anthropicon
            name="add"
            className={cn(
              'text-sidebar-text-secondary transition-colors group-hover/new:text-sidebar-text-primary',
              props.isActive && 'text-sidebar-text-primary',
            )}
          />
        </div>
      </div>
      <span className="whitespace-nowrap text-sm leading-[21px]">{props.label}</span>
      {props.shortcut && (
        <span className="ml-auto mr-2 translate-y-px text-[12px] leading-[17px] text-sidebar-text-muted opacity-0 transition-opacity group-hover/new:opacity-100">
          {props.shortcut}
        </span>
      )}
    </button>
  );
}
