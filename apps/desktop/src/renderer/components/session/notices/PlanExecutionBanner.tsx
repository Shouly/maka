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

// The approved plan being carried out, above the composer: how far it has
// got, and — once the Host has been interrupted — the way back or out.
//
// It stands where the Goal strip stands, for the same reason: what governs
// the next turn belongs beside the box that sends it. Running, it is a
// readout that folds its steps away; interrupted, it is the only place
// `resumePlan` and `abandonPlanExecution` have a caller.

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { PlanExecution, PlanExecutionStep } from '@maka/core/plan';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import {
  statusChipClass,
  statusChipNeutralClass,
  statusChipWarningClass,
} from '../../ui/status-chip.js';
import { cn } from '../../../lib/cn.js';
import { planStore } from '../../../store/index.js';
import { reportedExecution } from '../../../store/plan-store.js';
import { getPlanModeCopy, planControlFailureCopy } from '../../../locales/plan-mode-copy.js';
import { NoticeCard } from './NoticeCard.js';

const STEP_MARK: Record<PlanExecutionStep['status'], string> = {
  completed: '✓',
  in_progress: '•',
  skipped: '–',
  pending: '',
};

export function PlanExecutionBanner(props: { sessionId: string }) {
  const { sessionId } = props;
  const copy = getPlanModeCopy(useUiLocale());
  const execution = useStore(planStore, (state) => reportedExecution(state.data));
  const proposalTitle = useStore(planStore, (state) =>
    execution
      ? state.data?.proposals.find((item) => item.proposalId === execution.proposalId)?.title
      : undefined,
  );
  const pending = useStore(planStore.control, (state) => state.pending);
  const failure = useStore(planStore.control, (state) => state.failure);
  if (!execution) return null;
  return (
    <PlanExecutionStrip
      execution={execution}
      title={proposalTitle ?? copy.execution.approvedPlan}
      pending={pending}
      {...(failure ? { failureText: planControlFailureCopy(failure, copy) } : {})}
      onResume={() => void planStore.resume(sessionId, execution.executionId)}
      onAbandon={() => void planStore.abandonExecution(sessionId, execution.executionId)}
    />
  );
}

/** The strip itself, with nothing read from a store: what the tests render. */
export function PlanExecutionStrip(props: {
  execution: PlanExecution;
  title: string;
  pending: boolean;
  failureText?: string;
  onResume: () => void;
  onAbandon: () => void;
}) {
  const { execution, title, pending, failureText } = props;
  const copy = getPlanModeCopy(useUiLocale());
  const [expanded, setExpanded] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const executionId = execution.executionId;
  useEffect(() => {
    setExpanded(false);
    setConfirmAbandon(false);
  }, [executionId]);

  const interrupted = execution.status === 'interrupted';
  const completed = execution.steps.filter(
    (step) => step.status === 'completed' || step.status === 'skipped',
  ).length;

  return (
    <section
      role="status"
      data-maka-contract="plan-execution-banner"
      data-status={execution.status}
      aria-label={copy.execution.aria}
      className="flex w-full flex-col gap-3 rounded-xl border border-hairline bg-surface-2 px-3 py-2"
    >
      <div className="flex w-full items-center gap-3">
        <Anthropicon
          name="tasks"
          size={18}
          className="shrink-0 text-text-muted"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-5 text-text-primary" title={title}>
            {title}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
            <span
              className={cn(
                statusChipClass,
                interrupted ? statusChipWarningClass : statusChipNeutralClass,
              )}
            >
              {interrupted ? copy.execution.interrupted : copy.execution.running}
            </span>
            <span className="truncate tabular-nums">
              {copy.execution.stepCount(completed, execution.steps.length)}
            </span>
          </p>
        </div>
        {interrupted && (
          <>
            <Button variant="default" size="sm" disabled={pending} onClick={props.onResume}>
              {copy.execution.resume}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmAbandon(true)}
            >
              {copy.execution.abandon}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="iconSm"
          aria-expanded={expanded}
          aria-label={expanded ? copy.execution.hideSteps : copy.execution.showSteps}
          title={expanded ? copy.execution.hideSteps : copy.execution.showSteps}
          onClick={() => setExpanded((value) => !value)}
        >
          <Anthropicon name={expanded ? 'collapse' : 'expand'} size={16} />
        </Button>
      </div>

      {expanded && (
        <ol className="flex flex-col gap-1.5 pl-[30px]">
          {execution.steps.map((step) => (
            <li
              key={step.id}
              data-status={step.status}
              className={cn(
                'flex min-w-0 items-center gap-2 text-sm leading-5',
                step.status === 'completed' || step.status === 'skipped'
                  ? 'text-text-muted'
                  : step.status === 'in_progress'
                    ? 'text-text-primary'
                    : 'text-text-secondary',
              )}
            >
              <span
                role="img"
                aria-label={copy.execution.stepStatuses[step.status]}
                title={copy.execution.stepStatuses[step.status]}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-alpha-1 text-[11px] leading-none"
              >
                {STEP_MARK[step.status]}
              </span>
              <span className={cn('truncate', step.status === 'skipped' && 'line-through')}>
                {step.title}
              </span>
            </li>
          ))}
        </ol>
      )}

      {failureText && <NoticeCard tone="destructive" role="alert" title={failureText} />}

      <ConfirmDialog
        open={confirmAbandon}
        onOpenChange={setConfirmAbandon}
        title={copy.abandonConfirmation.title}
        description={copy.abandonConfirmation.description(title)}
        confirmText={copy.abandonConfirmation.confirm}
        cancelText={copy.abandonConfirmation.cancel}
        variant="destructive"
        onConfirm={props.onAbandon}
      />
    </section>
  );
}
