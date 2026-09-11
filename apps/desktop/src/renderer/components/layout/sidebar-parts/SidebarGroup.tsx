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

// One grouping grammar for the whole list. Ported from the reference design
// system's `SidebarGrouping`, minus the parts that only exist there (the
// `next/link` "view all" row, the project deep-link action, the `none` mode).
//
// Every group is the same shape: a small muted label row that reveals a caret
// and its actions on hover or keyboard focus, then the rows. No group is
// visually special, so the group-by menu can hang off the first label's action
// slot without looking like it belongs to that group in particular.

import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';
import type { SidebarCopy } from '../../../locales/sidebar-copy.js';

export const labelActionRevealClass =
  'pointer-events-none opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover/section:pointer-events-auto group-hover/section:opacity-100 group-focus-within/labelrow:pointer-events-auto group-focus-within/labelrow:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 motion-reduce:transition-none';

export const labelActionButtonClass =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-text-muted transition-[color,background-color,box-shadow] hover:bg-sidebar-menu-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none motion-reduce:transition-none';

function SidebarGroupLabel(props: {
  labelId?: string;
  title: string;
  contentId?: string;
  isContentHidden?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  copy: SidebarCopy;
}) {
  return (
    <div className="group/labelrow flex h-11 items-center gap-2 pb-1 pl-1.5 pr-1 pt-4 text-[0.8125rem] leading-4 text-sidebar-text-muted">
      {props.onToggle ? (
        <button
          type="button"
          onClick={props.onToggle}
          aria-label={
            props.isContentHidden
              ? props.copy.expandSection(props.title)
              : props.copy.collapseSection(props.title)
          }
          aria-expanded={!props.isContentHidden}
          aria-controls={props.contentId}
          // `-m-1 p-1` is a pair: the hit area and focus ring grow to 24px and
          // the negative margin takes the growth back out of the layout.
          className="group/toggle -m-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-lg p-1 text-left transition-[color,box-shadow] hover:text-sidebar-text-secondary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none motion-reduce:transition-none"
        >
          <span id={props.labelId} className="min-w-0 truncate">
            {props.title}
          </span>
          <Anthropicon
            name="caretRight"
            className={cn(
              'shrink-0 opacity-0 transition-[opacity,rotate] duration-[var(--dur-fast)] group-hover/section:opacity-100 group-focus-within/labelrow:opacity-100 motion-reduce:transition-none',
              !props.isContentHidden && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <h3 id={props.labelId} className="min-w-0 flex-1 truncate">
          {props.title}
        </h3>
      )}
      {props.actions && <div className="flex shrink-0 items-center gap-1">{props.actions}</div>}
    </div>
  );
}

export function SidebarGroup(props: {
  groupKey: string;
  title: string;
  isContentHidden: boolean;
  onContentHiddenChange: (hidden: boolean) => void;
  actions?: ReactNode;
  copy: SidebarCopy;
  /**
   * The rows. They sit directly inside an `AnimatePresence mode="popLayout"`,
   * so each must be a keyed element whose `ref` reaches its root DOM node — a
   * host element, or a component that forwards `ref` like `SessionRow`. Never
   * a Fragment: it cannot take the ref, and React warns on every render.
   */
  children: ReactNode;
}) {
  const labelId = `sidebar-group-${props.groupKey}-label`;
  const itemsId = `sidebar-group-${props.groupKey}-items`;
  const onContentHiddenChange = props.onContentHiddenChange;

  return (
    <section className="group/section flex flex-col gap-px" aria-labelledby={labelId}>
      <SidebarGroupLabel
        labelId={labelId}
        title={props.title}
        contentId={itemsId}
        isContentHidden={props.isContentHidden}
        onToggle={() => props.onContentHiddenChange(!props.isContentHidden)}
        actions={props.actions}
        copy={props.copy}
      />
      <AnimatePresence initial={false}>
        {!props.isContentHidden && (
          <AnimatedGroupContent key={itemsId} id={itemsId}>
            <AnimatePresence mode="popLayout">{props.children}</AnimatePresence>
          </AnimatedGroupContent>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Collapsed group keys, cleared whenever the grouping itself changes. */
export function useHiddenGroupKeys(resetKey: string) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setHidden(new Set());
  }, [resetKey]);
  return [
    hidden,
    (groupKey: string, isHidden: boolean) =>
      setHidden((current) => {
        if (current.has(groupKey) === isHidden) return current;
        const next = new Set(current);
        if (isHidden) next.add(groupKey);
        else next.delete(groupKey);
        return next;
      }),
  ] as const;
}

function AnimatedGroupContent(props: { id: string; children: ReactNode }) {
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      id={props.id}
      aria-hidden={!present || undefined}
      inert={!present || undefined}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="space-y-[1.5px] pb-[0.5px]">{props.children}</div>
    </motion.div>
  );
}
