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

// One contiguous run of tool calls, collapsed to a summary line.
//
// Ported from the reference design system's `TaskToolGroup`, including the
// rule that decides what "collapsed" means. It is not one state but two:
//
//   still running + collapsed = a sliding window onto the last few steps
//   finished     + collapsed = the summary line alone
//
// Both are the default, which is what makes the transition free: when the run
// ends the window's rows fall from three to zero on their own, and nothing has
// to reach in and re-collapse a group the reader opened.

import { memo, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useUiLocale, type ToolActivityItem } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { ToolRow } from './ToolRow.js';
import type { ToolContentContext } from './registry.js';
import { activeToolLabel, summarizeToolGroup } from './tool-presentation.js';

/** How many steps a running group keeps visible while collapsed. */
export const COLLAPSED_VISIBLE_COUNT = 3;

export interface ToolGroupProps {
  items: readonly ToolActivityItem[];
  /** False while the group can still gain steps. */
  complete: boolean;
  context: ToolContentContext;
  onSwitchToFullAccessAndRetry?: (item: ToolActivityItem) => void;
  switchingToolUseId?: string;
}

export const ToolGroup = memo(function ToolGroup(props: ToolGroupProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).tools;
  const [collapsed, setCollapsed] = useState(true);

  const summary = useMemo(
    () =>
      props.complete
        ? summarizeToolGroup(props.items, locale)
        : activeToolLabel(props.items, locale),
    [props.complete, props.items, locale],
  );

  if (props.items.length === 0) return null;

  const windowed = !props.complete && collapsed;
  const visible = windowed
    ? props.items.slice(Math.max(0, props.items.length - COLLAPSED_VISIBLE_COUNT))
    : props.items;
  const showSteps = !props.complete || !collapsed;
  // Something is folded above the first visible row, so the timeline has to
  // keep its top segment or it appears to start out of nowhere.
  const hasHiddenSteps = visible.length < props.items.length;
  // While running with no more steps than the window holds, opening changes
  // nothing — do not offer a control that does nothing.
  const canToggle = props.complete || props.items.length > COLLAPSED_VISIBLE_COUNT;

  return (
    <div className="my-2" data-maka-tool-group="">
      <div className="group/summary flex min-w-0 items-center gap-2 py-1">
        {canToggle ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? copy.expand(summary) : copy.collapse(summary)}
            onClick={() => setCollapsed((open) => !open)}
            className="flex min-w-0 cursor-pointer select-none items-center gap-2 rounded-md text-sm leading-5 text-text-muted outline-none transition-colors hover:text-text-secondary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
          >
            <span className="min-w-0 truncate">{summary}</span>
            <Anthropicon
              name="caretDown"
              size={12}
              className={cn(
                'shrink-0 opacity-0 transition-all duration-200',
                'group-hover/summary:opacity-100 group-focus-within/summary:opacity-100',
                collapsed && '-rotate-90',
              )}
            />
          </button>
        ) : (
          <span
            className="min-w-0 truncate text-sm leading-5 text-text-muted"
            role={props.complete ? undefined : 'status'}
          >
            {summary}
          </span>
        )}
      </div>

      <div className="mt-1" aria-label={copy.stepsLabel}>
        <AnimatePresence initial={false}>
          {showSteps &&
            visible.map((item, index) => (
              <motion.div
                key={item.toolUseId}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <ToolRow
                  item={item}
                  isFirst={!hasHiddenSteps && index === 0}
                  isLast={index === visible.length - 1}
                  context={props.context}
                  {...(props.onSwitchToFullAccessAndRetry
                    ? {
                        onSwitchToFullAccessAndRetry: () =>
                          props.onSwitchToFullAccessAndRetry?.(item),
                      }
                    : {})}
                  switching={props.switchingToolUseId === item.toolUseId}
                />
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
});
