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

// What the system says once, ahead of the user's first message, and again
// only when it changes: the memory snapshot and the other prompt contexts,
// the tools held behind ToolSearch, the session facts (model, permission
// mode, sandbox boundary) and the date.
//
// Every block is a durable `injection` RuntimeEvent on the turn it arrived
// with, rendered ahead of that turn's user text on every replay. Nothing here
// is re-sent per request: the plan compares what the ledger already holds
// with what is true now and emits only the difference — the reference
// harness's `_delta` records.

import { createHash } from 'node:crypto';
import type { CollaborationMode } from '@maka/core/collaboration';
import type { PermissionMode } from '@maka/core/permission';
import type { RuntimeEvent, RuntimeEventInjectionContent } from '@maka/core/runtime-event';
import type { ExecutionBoundaryReadModel } from '@maka/core/sandbox-boundary';
import { formatLocalDate, resolveZone } from './user-message-injections.js';

/** A block the host resolved for the session: the memory snapshot, the skills listing, a plugin's context. */
export interface InjectionContext {
  readonly name: string;
  readonly text: string;
  /** Changes when the text does; without one the text itself is compared. */
  readonly revision?: string;
}

export interface TurnInjectionFacts {
  readonly now: Date;
  readonly contexts: readonly InjectionContext[];
  /** Tools the provider is told about only through ToolSearch, on this request. */
  readonly deferredToolNames: readonly string[];
  readonly modelId?: string;
  readonly permissionMode?: PermissionMode;
  readonly collaborationMode?: CollaborationMode;
  readonly executionBoundary?: ExecutionBoundaryReadModel;
}

/** What the ledger already says under a name: the last `injection` event's data. */
export interface RecordedInjection {
  readonly name: string;
  readonly data?: Record<string, unknown>;
}

export type PlannedInjection = Omit<RuntimeEventInjectionContent, 'kind'>;

export const DEFERRED_TOOLS_INJECTION = 'deferred_tools';
export const SESSION_FACTS_INJECTION = 'session_facts';
export const DATE_INJECTION = 'date';

const PERMISSION_MODE_COPY: Readonly<Record<PermissionMode, string>> = {
  explore:
    'read-only. Files anywhere on this machine can be read, but tools that write files or run commands with side effects are refused; describe what you would change instead of attempting it.',
  ask: 'reads anywhere on this machine, writes inside the workspace and the temporary directories, and the network is open. Writing anywhere else needs a boundary expansion the user approves; request the smallest one that unblocks the call, once.',
  // No sandbox and nothing to approve, so the one rule left is on destructive
  // commands. It lives here because the system prompt carries none, and it
  // spares what the user asked for: a blanket "confirm first" made the model
  // stop before an `rm` the user had typed out.
  bypass:
    "full access. No filesystem sandboxing - all commands are permitted. Network access is enabled. Nothing needs the user's approval. Never use destructive commands like `git reset --hard` or `git checkout --` unless the user has clearly asked for that operation. If the request is ambiguous, ask the user first.",
};

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

/** The announcement of the tools held behind ToolSearch, one name per line. */
export function renderDeferredToolsNotice(names: readonly string[]): string {
  return [
    'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:',
    ...names,
  ].join('\n');
}

/** The calendar day turned over since the last turn. */
export function renderDateChangedNotice(date: string): string {
  return `The date has changed. Today's date is now ${date}. No need to announce the new date — the user's own clock shows it.`;
}

export function renderTodayLine(date: string): string {
  return `Today's date is ${date}.`;
}

/** The facts a turn runs under. Facts the host does not know are left out, never invented. */
export function renderSessionFacts(
  facts: Pick<
    TurnInjectionFacts,
    'modelId' | 'permissionMode' | 'collaborationMode' | 'executionBoundary'
  >,
): string | undefined {
  const lines: string[] = [];
  if (facts.modelId) {
    lines.push(
      `The model serving this session is ${facts.modelId}. Say so only if asked; it can change mid-session.`,
    );
  }
  if (facts.permissionMode) {
    const plan = facts.collaborationMode === 'plan';
    lines.push(
      `Permission mode: ${facts.permissionMode}, ${PERMISSION_MODE_COPY[facts.permissionMode]}${
        plan
          ? ' Plan mode is active on top of it: inspect and propose, do not modify files until the plan is approved.'
          : ''
      }`,
    );
  }
  const boundary = boundaryCopy(facts.executionBoundary);
  if (boundary) lines.push(boundary);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function sessionFactsData(facts: TurnInjectionFacts): Record<string, unknown> {
  return {
    ...(facts.modelId ? { modelId: facts.modelId } : {}),
    ...(facts.permissionMode ? { permissionMode: facts.permissionMode } : {}),
    ...(facts.collaborationMode ? { collaborationMode: facts.collaborationMode } : {}),
    ...(facts.executionBoundary
      ? { boundary: `${facts.executionBoundary.kind}:${facts.executionBoundary.revision}` }
      : {}),
  };
}

function textRevision(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function sameData(a: Record<string, unknown> | undefined, b: Record<string, unknown>): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** The last thing the ledger recorded under each name. */
export function collectRecordedInjections(
  events: readonly RuntimeEvent[],
): ReadonlyMap<string, RecordedInjection> {
  const byName = new Map<string, RecordedInjection>();
  for (const event of events) {
    if (event.content?.kind !== 'injection') continue;
    byName.set(event.content.name, {
      name: event.content.name,
      ...(event.content.data ? { data: event.content.data } : {}),
    });
  }
  return byName;
}

/**
 * The blocks this turn adds to the ledger, in the order they are read:
 * contexts as the host listed them, then the held tools, the session facts,
 * the date. A first turn — or one after compaction folded the earlier
 * records away — gets everything; a later turn gets only what moved.
 */
export function planTurnInjections(
  prior: ReadonlyMap<string, RecordedInjection>,
  facts: TurnInjectionFacts,
  timeZone: string | undefined,
): PlannedInjection[] {
  const planned: PlannedInjection[] = [];

  for (const context of facts.contexts) {
    if (context.text.trim().length === 0) continue;
    const revision = context.revision ?? textRevision(context.text);
    if (prior.get(context.name)?.data?.revision === revision) continue;
    planned.push({ name: context.name, text: context.text, data: { revision } });
  }

  // A held tool is announced once, when it first appears. One that leaves the
  // held set — loaded through ToolSearch, or gone with its connector — is not
  // spoken of: the record keeps every name ever announced, so a tool the
  // model already knows about is never announced again.
  const announced = new Set(stringList(prior.get(DEFERRED_TOOLS_INJECTION)?.data?.names));
  const added = [...new Set(facts.deferredToolNames)].filter((name) => !announced.has(name)).sort();
  if (added.length > 0) {
    planned.push({
      name: DEFERRED_TOOLS_INJECTION,
      text: renderDeferredToolsNotice(added),
      data: { names: [...announced, ...added].sort() },
    });
  }

  const factsText = renderSessionFacts(facts);
  const factsData = sessionFactsData(facts);
  if (factsText && !sameData(prior.get(SESSION_FACTS_INJECTION)?.data, factsData)) {
    planned.push({ name: SESSION_FACTS_INJECTION, text: factsText, data: factsData });
  }

  const today = formatLocalDate(facts.now, resolveZone(timeZone, facts.now));
  const recordedDate = prior.get(DATE_INJECTION)?.data?.date;
  if (recordedDate === undefined) {
    planned.push({ name: DATE_INJECTION, text: renderTodayLine(today), data: { date: today } });
  } else if (recordedDate !== today) {
    planned.push({
      name: DATE_INJECTION,
      text: renderDateChangedNotice(today),
      data: { date: today },
    });
  }

  return planned;
}
