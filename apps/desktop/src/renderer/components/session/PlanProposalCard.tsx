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

// A plan proposal, in the transcript after the turn that made it.
//
// Plan mode's answer is not prose: the model hands back a titled list of
// steps and waits. The card is that answer, standing where the reply would —
// after its turn, never inside a work group — and while it is the latest and
// still waiting it carries the two decisions the Host takes: revise, which
// keeps planning, and execute, which starts the turn that carries it out.
//
// A superseded or approved proposal keeps its card, greyed by its status
// chip, so the conversation still reads as what was proposed and when.
// The Host's refusal of a decision (stale, busy, conflict) is shown under the
// buttons, not toasted: it is about this card and the fix is on it.

import { useStore } from 'zustand';
import type { PlanProposal } from '@maka/core/plan';
import { useUiLocale } from '@maka/ui';
import { cn } from '../../lib/cn.js';
import { planStore } from '../../store/index.js';
import { getPlanModeCopy, planControlFailureCopy } from '../../locales/plan-mode-copy.js';
import { Button } from '../ui/button.js';
import {
  statusChipClass,
  statusChipNeutralClass,
  statusChipSuccessClass,
  statusChipWarningClass,
} from '../ui/status-chip.js';
import { NoticeCard } from './notices/NoticeCard.js';

const STATUS_CHIP: Record<PlanProposal['status'], string> = {
  pending_approval: statusChipWarningClass,
  approved: statusChipSuccessClass,
  stale: statusChipNeutralClass,
};

export function PlanProposalCard(props: {
  sessionId: string;
  proposal: PlanProposal;
  /** The latest proposal, still waiting: the only one with decisions on it. */
  reviewable: boolean;
}) {
  const { sessionId, proposal, reviewable } = props;
  const copy = getPlanModeCopy(useUiLocale());
  const pending = useStore(planStore.control, (state) => state.pending);
  const failure = useStore(planStore.control, (state) => state.failure);
  return (
    <PlanProposalCardView
      proposal={proposal}
      reviewable={reviewable}
      pending={pending}
      {...(failure ? { failureText: planControlFailureCopy(failure, copy) } : {})}
      onRevise={() => void planStore.requestRevision(sessionId, proposal.proposalId)}
      onExecute={() => void planStore.approve(sessionId, proposal)}
    />
  );
}

/** The card itself, with nothing read from a store: what the tests render. */
export function PlanProposalCardView(props: {
  proposal: PlanProposal;
  reviewable: boolean;
  pending: boolean;
  failureText?: string;
  onRevise: () => void;
  onExecute: () => void;
}) {
  const { proposal, reviewable, pending, failureText } = props;
  const copy = getPlanModeCopy(useUiLocale());

  return (
    <section
      aria-label={copy.proposal.aria}
      data-maka-plan-proposal={proposal.proposalId}
      data-status={proposal.status}
      className={cn(
        'my-3 flex min-w-0 flex-col gap-4 rounded-xl border border-hairline p-4',
        proposal.status === 'stale' && 'opacity-70',
      )}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {copy.proposal.kicker}
          </span>
          <h2 className="text-base font-medium leading-6 text-text-primary">{proposal.title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn(statusChipClass, statusChipNeutralClass, 'tabular-nums')}>
            {copy.proposal.revision} {proposal.revision}
          </span>
          <span className={cn(statusChipClass, STATUS_CHIP[proposal.status])}>
            {copy.proposal.statuses[proposal.status]}
          </span>
        </div>
      </header>

      {proposal.overview && (
        <p className="text-sm leading-6 text-text-secondary">{proposal.overview}</p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-text-muted">{copy.proposal.steps}</h3>
        <ol className="flex flex-col gap-2.5">
          {proposal.steps.map((step, index) => (
            <li key={step.id} className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-alpha-1 text-[11px] font-medium tabular-nums text-text-secondary"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium leading-5 text-text-primary">
                  {step.title}
                </span>
                {step.description && (
                  <p className="text-sm leading-5 text-text-secondary">{step.description}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {proposal.risks && proposal.risks.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-text-muted">{copy.proposal.risks}</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {proposal.risks.map((risk, index) => (
              <li key={`${index}:${risk}`} className="text-sm leading-5 text-text-secondary">
                {risk}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewable && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={props.onRevise}>
              {copy.proposal.revise}
            </Button>
            <Button variant="default" size="sm" disabled={pending} onClick={props.onExecute}>
              {copy.proposal.execute}
            </Button>
          </div>
          {failureText && <NoticeCard tone="destructive" role="alert" title={failureText} />}
        </div>
      )}
    </section>
  );
}
