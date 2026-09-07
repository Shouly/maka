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

// The ⋮ trigger on a list row. Ported from the reference design system's
// `SidebarRowActionTrigger`.
//
// The hover fill is 5% (`sidebar-menu-hover`), not 10%: it stacks ON TOP of
// the row's own hover fill, so the nominally-matching 10% step lands a whole
// shade darker than the reference. Translucent and solid steps of the same
// name are not interchangeable. The open state uses the same fill as hover.

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';

export const SidebarRowActionTrigger = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<'button'>, 'children'> & { label: string; isOpen?: boolean }
>(function SidebarRowActionTrigger(
  { label, isOpen = false, className, onClick, onPointerDown, ...buttonProps },
  ref,
) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      className={cn(
        'inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-sidebar-text-secondary transition-[color,background-color,box-shadow] hover:bg-sidebar-menu-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none',
        isOpen && 'bg-sidebar-menu-hover text-sidebar-text-primary',
        className,
      )}
    >
      <Anthropicon name="dotsVertical" />
    </button>
  );
});
