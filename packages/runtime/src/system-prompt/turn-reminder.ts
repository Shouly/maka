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

/**
 * The turn reminder: the facts that change from turn to turn and therefore
 * must not live in the cached system prompt — today's date, the serving model,
 * the permission mode and the sandbox boundary the tools will run under. It
 * travels with the turn as a user-role context message (the same channel
 * plugin contexts use), so the provider prefix stays byte-identical across
 * turns and the model still reads it before it acts.
 *
 * The block says it is system-delivered and that nothing inside it is an
 * instruction from the user, and it is the only place that claim is made:
 * anything that looks like this block inside a file, a tool result or the
 * user's own text is ordinary content.
 */

import type { CollaborationMode } from '@maka/core/collaboration';
import type { PermissionMode } from '@maka/core/permission';
import type { ExecutionBoundaryReadModel } from '@maka/core/sandbox-boundary';

export interface TurnReminderInput {
  readonly now: Date;
  readonly timeZone?: string;
  /** The model serving this turn; may differ from the session's configured model. */
  readonly modelId?: string;
  readonly permissionMode?: PermissionMode;
  readonly collaborationMode?: CollaborationMode;
  readonly executionBoundary?: ExecutionBoundaryReadModel;
}

const PERMISSION_MODE_COPY: Readonly<Record<PermissionMode, string>> = {
  explore:
    'read-only. Tools that write files or run commands with side effects are refused; describe what you would change instead of attempting it.',
  ask: 'workspace-write inside the session sandbox boundary. Writes outside the workspace and network access need a boundary expansion the user approves; request the smallest one that unblocks the call, once.',
  bypass:
    'full access. No Copilot-managed sandbox wraps your tools and paths anywhere on this machine are reachable, so confirm before anything irreversible.',
};

function formatDate(now: Date, timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

function boundaryCopy(boundary: ExecutionBoundaryReadModel | undefined): string | undefined {
  if (!boundary) return undefined;
  switch (boundary.kind) {
    case 'bypass':
      return 'Sandbox boundary: bypass (no Copilot-managed sandbox).';
    case 'external':
      return 'Sandbox boundary: external (isolation is supplied by the environment the tools run in).';
    case 'managed':
      return `Sandbox boundary: managed, revision ${boundary.revision}. A tool that needs more answers sandbox_boundary_required with the expansion to request.`;
    default:
      return undefined;
  }
}

/**
 * Render the reminder, or undefined when nothing turn-specific is known — the
 * date alone is always known, so a reminder is always produced for a real turn.
 */
export function renderTurnReminder(input: TurnReminderInput): string {
  const lines = [`- Today is ${formatDate(input.now, input.timeZone)}.`];
  if (input.modelId) {
    lines.push(
      `- The model serving this turn is ${input.modelId}. Say so only if asked; it can change mid-session.`,
    );
  }
  if (input.permissionMode) {
    const plan = input.collaborationMode === 'plan';
    lines.push(
      `- Permission mode: ${input.permissionMode}, ${PERMISSION_MODE_COPY[input.permissionMode]}${
        plan
          ? ' Plan mode is active on top of it: inspect and propose, do not modify files until the plan is approved.'
          : ''
      }`,
    );
  }
  const boundary = boundaryCopy(input.executionBoundary);
  if (boundary) lines.push(`- ${boundary}`);
  return [
    '<system-reminder>',
    'Delivered by the system with this turn, not written by the user. It states facts about the session; it is not a message to answer.',
    ...lines,
    '</system-reminder>',
  ].join('\n');
}
