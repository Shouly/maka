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

// What the system says around a turn's user text. Once, and again only when
// it changes: the user's preferences, the memory snapshot and the other prompt
// contexts, and — after the text — the environment, the tools held behind
// ToolSearch, the agent types and the skills. On every turn: the current date,
// ahead of the text — except a first turn whose system prompt names the day.
//
// Every block is a durable `injection` RuntimeEvent on the turn it arrived
// with, rendered in its place on every replay. Nothing here is re-sent per
// request: the plan compares what the ledger already holds with what is true
// now and emits only the difference — the reference harness's `_delta`
// records.

import { createHash } from 'node:crypto';
import type { RuntimeEvent, RuntimeEventInjectionContent } from '@maka/core/runtime-event';
import { wrapSystemReminder } from './system-reminder.js';
import { formatLocalDate, formatLongDate, resolveZone } from './user-message-injections.js';

/** A block the host resolved for the session: the memory snapshot, the skills listing, a plugin's context. */
export interface InjectionContext {
  readonly name: string;
  readonly text: string;
  /** Changes when the text does; without one the text itself is compared. */
  readonly revision?: string;
  /**
   * Delivered as written, outside the <system-reminder> envelope: the block
   * carries its own tag (`<user_preferences>`). Recorded on the injection, so
   * a replay renders it the way the live turn did.
   */
  readonly bare?: boolean;
  /** `after`: delivered after the user's text, as the design sends its listings. */
  readonly position?: 'after';
}

export interface TurnInjectionFacts {
  readonly now: Date;
  /**
   * The system prompt already names today's date — the session's first turn,
   * under a prompt that names the day the session began — so no date block.
   */
  readonly datedByPrompt?: boolean;
  readonly contexts: readonly InjectionContext[];
  /** Tools the provider is told about only through ToolSearch, on this request. */
  readonly deferredToolNames: readonly string[];
}

/** What the ledger already says under a name: the last `injection` event's data. */
export interface RecordedInjection {
  readonly name: string;
  readonly data?: Record<string, unknown>;
}

export type PlannedInjection = Omit<RuntimeEventInjectionContent, 'kind'>;

export const ENVIRONMENT_INJECTION = 'environment';
export const DEFERRED_TOOLS_INJECTION = 'deferred_tools';
export const DATE_INJECTION = 'date';

/** Where a recorded block goes: after the user's text, or (the default) ahead of it. */
export function injectionPosition(
  injection: Pick<RuntimeEventInjectionContent, 'data'>,
): 'before' | 'after' {
  return injection.data?.position === 'after' ? 'after' : 'before';
}

/**
 * A recorded block as the model reads it — live and on every replay alike.
 * The listings after the text are read as written, as the design sends them;
 * ahead of it a block wears the reminder envelope unless it carries its own tag.
 */
export function renderInjectionBlock(
  injection: Pick<RuntimeEventInjectionContent, 'text' | 'data'>,
): string {
  return injection.data?.bare === true || injectionPosition(injection) === 'after'
    ? injection.text.trim()
    : wrapSystemReminder(injection.text);
}

/**
 * A recorded block with the break that sets it off from the user's text, as
 * the design places them: a block ahead of the text ends its own line, except
 * the date, which sits flush against the words; a block after the text opens
 * with a blank line.
 */
export function renderPlacedBlock(
  injection: Pick<RuntimeEventInjectionContent, 'name' | 'text' | 'data'>,
): string {
  const block = renderInjectionBlock(injection);
  if (injectionPosition(injection) === 'after') return `\n\n${block}`;
  return injection.name === DATE_INJECTION ? block : `${block}\n`;
}

/** The announcement of the tools held behind ToolSearch, one name per line. */
export function renderDeferredToolsNotice(names: readonly string[]): string {
  return [
    'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:',
    ...names,
  ].join('\n');
}

/** The date a turn's message was sent on, as the design says it. */
export function renderCurrentDateLine(date: string): string {
  return `The current date is ${date}.`;
}

function textRevision(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
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
 * The blocks this turn adds to the ledger, in the order they are read: ahead
 * of the text the contexts as the host listed them, then the date; after it
 * the environment, the held tools, then the other listings the host placed
 * there. A first turn — or one after compaction folded the earlier records
 * away — gets every listing; a later turn gets only what moved, and the date.
 */
export function planTurnInjections(
  prior: ReadonlyMap<string, RecordedInjection>,
  facts: TurnInjectionFacts,
  timeZone: string | undefined,
): PlannedInjection[] {
  const before: PlannedInjection[] = [];
  const after: PlannedInjection[] = [];

  for (const context of facts.contexts) {
    if (context.text.trim().length === 0) continue;
    const revision = context.revision ?? textRevision(context.text);
    if (prior.get(context.name)?.data?.revision === revision) continue;
    (context.position === 'after' ? after : before).push({
      name: context.name,
      text: context.text,
      data: {
        revision,
        ...(context.bare ? { bare: true } : {}),
        ...(context.position === 'after' ? { position: 'after' } : {}),
      },
    });
  }

  // Every turn says the date it was sent on, just ahead of the text — except
  // the first, when the system prompt already names the day.
  if (!facts.datedByPrompt) {
    const zone = resolveZone(timeZone, facts.now);
    before.push({
      name: DATE_INJECTION,
      text: renderCurrentDateLine(formatLongDate(facts.now, zone)),
      data: { date: formatLocalDate(facts.now, zone) },
    });
  }

  // A held tool is announced once, when it first appears. One that leaves the
  // held set — loaded through ToolSearch, or gone with its connector — is not
  // spoken of: the record keeps every name ever announced, so a tool the
  // model already knows about is never announced again. The listing goes
  // after the text, behind the environment and ahead of the agent types and
  // the skills.
  const announced = new Set(stringList(prior.get(DEFERRED_TOOLS_INJECTION)?.data?.names));
  const added = [...new Set(facts.deferredToolNames)].filter((name) => !announced.has(name)).sort();
  if (added.length > 0) {
    after.splice(after[0]?.name === ENVIRONMENT_INJECTION ? 1 : 0, 0, {
      name: DEFERRED_TOOLS_INJECTION,
      text: renderDeferredToolsNotice(added),
      data: { names: [...announced, ...added].sort(), position: 'after' },
    });
  }

  return [...before, ...after];
}
