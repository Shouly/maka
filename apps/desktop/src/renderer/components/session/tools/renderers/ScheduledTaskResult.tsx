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

// The card that confirms a scheduled task.
//
// Creating one hands the person something they now OWN and will come back to —
// not a step of the turn's work. So it is drawn as the reference draws it: one
// row, the clock, what happened and to which task, the schedule on the right,
// and a caret, because the whole card opens the task. A tool row whose result
// they have to expand and read would bury the only thing that matters.

import { memo } from 'react';
import {
  describeScheduledTaskCadence,
  useUiLocale,
  type ToolActivityItem,
  type UiLocale,
} from '@maka/ui';
import type { ScheduledTask } from '@maka/core/scheduled-task';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { Anthropicon } from '../../../icons/Anthropicon.js';
import { cn } from '../../../../lib/cn.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import { toolRowStatus } from '../tool-presentation.js';

/**
 * What the call named, read from the args rather than from the result text.
 *
 * Maka owns both ends, so the card reads the request it made instead of
 * parsing prose back out of its own answer — the id is the one thing only the
 * result knows, and it is the one thing parsed.
 */
export function readScheduledTaskCard(
  item: ToolActivityItem,
  locale: UiLocale,
): {
  mode: 'create' | 'update';
  title?: string;
  schedule?: string;
  taskId?: string;
} | null {
  // Which tool ran IS the verb now that they are one verb each — there is no
  // `mode` argument left to read, and a SendLater reminder is a create as far
  // as this card is concerned: something new that the person can open.
  const mode =
    item.toolName === TOOL_NAMES.scheduledTaskUpdate
      ? ('update' as const)
      : item.toolName === TOOL_NAMES.scheduledTaskCreate || item.toolName === TOOL_NAMES.sendLater
        ? ('create' as const)
        : null;
  if (!mode) return null;
  // The NAME can come from either: it is a string on the wire allowlist, so the
  // live preview carries it. The SCHEDULE cannot — `cron` is not an allowlisted
  // string and `runOnceAt` / `at` / `delayMinutes` are numbers, which the
  // preview only carries for `offset` and `limit`. Reading the schedule out of
  // a preview therefore sees nothing and would call every task manual, so it is
  // read only from the settled args and omitted until they arrive.
  const args = asRecord(item.args) ?? asRecord(item.argsPreview);
  const settled = asRecord(item.args);
  const named = args?.name ?? args?.message;
  const title = typeof named === 'string' && named.trim() ? named.trim() : undefined;
  const schedule = settled ? describeSchedule(settled, locale) : undefined;
  // `Created <title> (<id>)` / `Updated <title> (<id>)` / `Will deliver at … (<id>)`
  const text = resultText(item);
  const taskId = text?.match(/\(([^()\s]+)\)/u)?.[1];
  return {
    mode,
    ...(title ? { title } : {}),
    ...(schedule ? { schedule } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

/**
 * The cadence the call asked for, from the arguments it passed.
 *
 * The tools take a cron string, a one-shot timestamp or a delay rather than a
 * schedule object, so this rebuilds the one the shared formatter takes. Only
 * ever called with SETTLED args: neither key present then really does mean a
 * manual task, whereas reading a live preview would mean it every time.
 */
function describeSchedule(args: Record<string, unknown>, locale: UiLocale): string {
  const cron = typeof args.cron === 'string' && args.cron.trim() ? args.cron.trim() : undefined;
  // SendLater takes `delayMinutes` far more often than `at`, and leaving it out
  // made every "remind me in 30 minutes" card read "Manual".
  const runAt =
    typeof args.runOnceAt === 'number'
      ? args.runOnceAt
      : typeof args.at === 'number'
        ? args.at
        : typeof args.delayMinutes === 'number'
          ? Date.now() + args.delayMinutes * 60_000
          : undefined;
  const schedule = cron
    ? { kind: 'cron' as const, expression: cron, startAt: 0 }
    : runAt !== undefined
      ? { kind: 'once' as const, runAt }
      : { kind: 'manual' as const };
  // The shared formatter takes a task, and a task is what this is about to be.
  return describeScheduledTaskCadence({ schedule } as unknown as ScheduledTask, locale);
}

function resultText(item: ToolActivityItem): string | undefined {
  const result = item.result;
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  if (record.kind !== 'text') return undefined;
  return typeof record.text === 'string' ? record.text : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const ScheduledTaskResult = memo(function ScheduledTaskResult(props: {
  item: ToolActivityItem;
  onOpenScheduledTask?: (taskId: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).tools.scheduledTask;
  const card = readScheduledTaskCard(props.item, locale);
  if (!card) return null;
  const status = toolRowStatus(props.item);
  const running = status === 'running';
  const errored = status === 'errored';
  const taskId = card.taskId;
  const open =
    taskId && props.onOpenScheduledTask ? () => props.onOpenScheduledTask?.(taskId) : undefined;
  const label = running
    ? card.mode === 'update'
      ? copy.updating
      : copy.creating
    : card.mode === 'update'
      ? copy.updated
      : copy.created;

  const body = (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-text-muted">
        <Anthropicon name="clock" size={20} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm leading-5 text-text-secondary">
        {label}
        {card.title && (
          <>
            {': '}
            <span className="font-medium text-text-primary">{card.title}</span>
          </>
        )}
      </span>
      {errored ? (
        <Anthropicon name="warning" size={16} className="shrink-0 text-danger" />
      ) : (
        !running && (
          <span className="flex shrink-0 items-center gap-1">
            {card.schedule && (
              <span className="whitespace-nowrap text-xs leading-4 text-text-muted">
                {card.schedule}
              </span>
            )}
            {open && <Anthropicon name="caretRight" size={16} className="text-text-muted" />}
          </span>
        )
      )}
    </>
  );

  const shell =
    'my-3 flex items-center gap-2 rounded-lg border border-hairline px-3 py-2.5 select-none';
  return open ? (
    <button
      type="button"
      onClick={open}
      data-maka-scheduled-task-card={taskId}
      className={cn(
        shell,
        'w-full cursor-pointer text-left transition-colors hover:bg-surface-0',
        'focus-visible:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]',
      )}
    >
      {body}
    </button>
  ) : (
    <div className={shell} data-maka-scheduled-task-card="">
      {body}
    </div>
  );
});
