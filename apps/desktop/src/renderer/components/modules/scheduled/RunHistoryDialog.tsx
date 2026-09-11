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

// One task's run history.
//
// The card can only afford the last outcome, and the last outcome alone is the
// least useful half of the record: a task that says "Failed" without saying
// why is a task nobody can fix. The Host keeps the last
// `SCHEDULED_TASK_RUN_HISTORY_LIMIT` runs with their message and, for an
// `agent_run` effect, the session the run started — so every run here carries
// its time, its outcome, what it said, and a way into the task it produced.
//
// A dialog rather than an expanding card: the cards are a two-column grid, and
// a card that grows to twenty rows reflows the one beside it.

import type { ScheduledTask, ScheduledTaskRun } from '@maka/core/scheduled-task';
import {
  formatTaskTime,
  getScheduledTaskCopy,
  runStatusLabel,
  scheduledTaskRunStatusSemantic,
  useUiLocale,
} from '@maka/ui';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import { getScheduledPageCopy } from '../../../locales/scheduled-page-copy.js';

export function RunHistoryDialog(props: {
  /** `null` closes the dialog; the task is re-read from the list every render. */
  task: ScheduledTask | null;
  clearing: boolean;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const locale = useUiLocale();
  const catalog = getScheduledTaskCopy(locale);
  const page = getScheduledPageCopy(locale);
  const shared = getSettingsSharedCopy(locale);
  const task = props.task;
  // Newest first. The Host prepends, but a task whose history was merged from
  // two Hosts has no such guarantee and the order is what makes the list read.
  const runs = task ? [...task.runs].sort((a, b) => b.at - a.at) : [];

  return (
    <Dialog open={task !== null} onOpenChange={props.onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader closeLabel={shared.close}>
          <DialogTitle>{task ? page.runHistoryTitle(task.title) : ''}</DialogTitle>
        </DialogHeader>

        <RunHistoryList runs={runs} onOpenSession={props.onOpenSession} />

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={props.onClear}
            disabled={props.clearing || runs.length === 0}
            aria-busy={props.clearing || undefined}
          >
            {props.clearing ? catalog.page.clearing : catalog.page.clearRuns}
          </Button>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            {shared.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The runs themselves, outside the dialog that frames them.
 *
 * Split out because a Radix dialog renders through a portal, and a portal
 * renders into nothing at all on the server — which would leave the one place
 * on this page that says WHY a run failed with no test at all.
 */
export function RunHistoryList(props: {
  runs: readonly ScheduledTaskRun[];
  onOpenSession: (sessionId: string) => void;
}) {
  const locale = useUiLocale();
  const catalog = getScheduledTaskCopy(locale);
  const page = getScheduledPageCopy(locale);
  if (props.runs.length === 0) {
    return <p className="text-sm leading-5 text-text-secondary">{catalog.detail.noRuns}</p>;
  }
  return (
    <ul className="flex flex-col">
      {props.runs.map((run) => {
        // Bound outside the handler: `run.sessionId` is an optional property,
        // so the guard below would not narrow inside a closure.
        const sessionId = run.sessionId;
        return (
          <li
            key={run.id}
            className="flex flex-col gap-1.5 border-b border-hairline py-3 last:border-b-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm leading-5 text-text-primary">
                {formatTaskTime(run.at, locale)}
              </span>
              <span
                className={cn(
                  statusChipClass,
                  statusChipToneClass(scheduledTaskRunStatusSemantic(run.outcome)),
                )}
              >
                {runStatusLabel(run.outcome, locale)}
              </span>
            </div>
            {/* A failed run's message IS the failure. The card has room for the
                outcome and nothing else, so this is the only place the reason
                is ever said. */}
            {run.message && (
              <p className="text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                {run.message}
              </p>
            )}
            {sessionId && (
              <div>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => props.onOpenSession(sessionId)}
                >
                  <Anthropicon name="arrowUpRight" size={16} />
                  {page.openSession}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
