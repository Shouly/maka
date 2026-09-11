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

// `subagent` and `agent_swarm` — a child task, or a fan-out of them.
//
// A child task is a real Session, so the row is a way INTO it rather than a
// summary of it: clicking opens that Session in the shell. When the child has
// no session id (an old transcript, or a spawn that failed before the Host
// named one) the row stays a plain row instead of a button that would do
// nothing — a dead affordance reads as a bug in the child, not in the row.

import { memo } from 'react';
import type { ToolResultContent } from '@maka/core/events';
import {
  dotForStatus,
  formatDuration,
  getToolActivityCopy,
  useUiLocale,
  type StatusDotVariant,
  type StatusSemantic,
} from '@maka/ui';
import { cn } from '../../../../lib/cn.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import { ToolResultPanel, ToolResultRow } from '../tool-result.js';

type SubagentContent = Extract<ToolResultContent, { kind: 'subagent' }>;
type SwarmContent = Extract<ToolResultContent, { kind: 'agent_swarm' }>;

type AgentStatus = SubagentContent['status'];

/** What a child's status MEANS, before it becomes a colour. */
const SEMANTIC_BY_STATUS: Record<AgentStatus, StatusSemantic> = {
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
  running: 'active',
  waiting_for_user: 'attention',
};

const DOT_CLASS: Record<StatusDotVariant, string> = {
  success: 'bg-success-fill',
  warning: 'bg-warning-fill',
  error: 'bg-danger-fill',
  accent: 'bg-accent-fill',
  neutral: 'bg-alpha-4',
};

function StatusDot(props: { status: AgentStatus }) {
  const variant = dotForStatus(SEMANTIC_BY_STATUS[props.status]);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-2 shrink-0 rounded-full',
        DOT_CLASS[variant],
        props.status === 'running' && 'animate-status-dot-breathe',
      )}
    />
  );
}

function AgentRow(props: {
  name: string;
  status: AgentStatus;
  durationMs?: number;
  readOnly?: boolean;
  failureClass?: string;
  childSessionId?: string;
  onOpenSession: (sessionId: string) => void;
}) {
  const locale = useUiLocale();
  const agentCopy = getToolActivityCopy(locale).agent;
  const copy = getTranscriptCopy(locale).result;
  const duration = formatDuration(props.durationMs);
  const meta = [
    agentCopy.subagentStatus[props.status],
    props.readOnly ? agentCopy.readOnly : undefined,
    duration ?? undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ToolResultRow
      icon={<StatusDot status={props.status} />}
      meta={meta}
      title={props.failureClass ? copy.failureClass(props.failureClass) : undefined}
      {...(props.childSessionId
        ? {
            onClick: () => props.onOpenSession(props.childSessionId!),
            ariaLabel: `${copy.openChildSession}: ${props.name}`,
          }
        : {})}
    >
      {props.name}
    </ToolResultRow>
  );
}

export const SubagentResult = memo(function SubagentResult(props: {
  result: SubagentContent;
  onOpenSession: (sessionId: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).result;
  const readOnly = props.result.permissionMode === 'explore';
  return (
    <ToolResultPanel variant="list">
      <AgentRow
        name={props.result.agentName}
        status={props.result.status}
        {...(props.result.durationMs !== undefined ? { durationMs: props.result.durationMs } : {})}
        readOnly={readOnly}
        {...(props.result.failureClass ? { failureClass: props.result.failureClass } : {})}
        {...(props.result.childSessionId ? { childSessionId: props.result.childSessionId } : {})}
        onOpenSession={props.onOpenSession}
      />
      {props.result.summary.trim().length > 0 && (
        <p className="px-2 pb-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
          {props.result.summary}
        </p>
      )}
      {!props.result.childSessionId && (
        <p className="px-2 pb-1 text-xs leading-4 text-text-muted">
          {copy.childSessionUnavailable}
        </p>
      )}
    </ToolResultPanel>
  );
});

export const AgentSwarmResult = memo(function AgentSwarmResult(props: {
  result: SwarmContent;
  onOpenSession: (sessionId: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).result;
  return (
    <ToolResultPanel variant="list">
      <p className="px-2 pt-1 text-[0.6875rem] leading-none text-text-secondary">
        {copy.swarmItems(props.result.items.length)}
      </p>
      {props.result.items.map((item) => (
        <AgentRow
          key={item.itemId}
          name={item.agentName ?? item.profile}
          status={item.status}
          {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
          {...(item.failureClass ? { failureClass: item.failureClass } : {})}
          {...(item.childSessionId ? { childSessionId: item.childSessionId } : {})}
          onOpenSession={props.onOpenSession}
        />
      ))}
    </ToolResultPanel>
  );
});
