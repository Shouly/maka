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

// Which renderer a tool row gets, what its header says, and what its group's
// one-line summary is — all of it pure, none of it React.
//
// Two keys decide the renderer, and they answer different questions. The
// ACTIVITY KIND (`command`, `edit`, `read`, …) is what the model asked for, so
// it owns the icon and the "in progress" wording — those have to be right
// before any result exists. The RESULT KIND (`file_diff`, `shell_run`,
// `subagent`, …) is what came back, so it owns the body. A row that ran a
// command and got a diff back shows a terminal icon over a diff, which is
// exactly what happened.
//
// Splitting them here rather than inside the components is what makes the
// registry testable: every kind in `TOOL_ACTIVITY_KINDS` and every result kind
// the runtime can emit resolves to a renderer id in a plain Node test, with no
// DOM.

import type { ToolActivityKind, ToolResultContent } from '@maka/core/events';
import type { UiLocale } from '@maka/core/ui-locale';
import {
  computerActionLabel,
  formatToolInvocationLine,
  getToolActivityCopy,
  isComputerTool,
  isSandboxDeniedTool,
  resolveToolDisplayName,
  toolActivityPresentationStatus,
  type ToolActivityItem,
} from '@maka/ui';
import type { AnthropiconName } from '../../icons/Anthropicon.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { isAskUserQuestionTool } from '../../../lib/ask-user-question.js';

/**
 * Which body a tool row renders. `none` means the row has a header and nothing
 * worth opening — a completed `file_write` says everything in its header.
 */
export type ToolRendererId =
  | 'diff'
  | 'file_write'
  | 'terminal'
  | 'web_search'
  | 'web_search_error'
  | 'subagent'
  | 'agent_swarm'
  | 'json'
  | 'image'
  | 'archived'
  | 'workflow'
  | 'text'
  | 'pending'
  | 'none';

/**
 * The renderer for a result, by its kind alone.
 *
 * Exhaustive over `ToolResultContent` on purpose: a kind added to the runtime
 * makes this fail to compile rather than reaching a user as a blank row.
 */
export function rendererForResultKind(kind: ToolResultContent['kind']): ToolRendererId {
  switch (kind) {
    case 'file_diff':
      return 'diff';
    case 'file_write':
      return 'file_write';
    case 'terminal':
    case 'shell_run':
      return 'terminal';
    case 'web_search':
      return 'web_search';
    case 'web_search_error':
      return 'web_search_error';
    case 'subagent':
      return 'subagent';
    case 'agent_swarm':
      return 'agent_swarm';
    case 'json':
      return 'json';
    case 'image':
      return 'image';
    case 'archived_tool_result':
      return 'archived';
    case 'rive_workflow':
      return 'workflow';
    case 'text':
    case 'summary':
      return 'text';
  }
}

/**
 * The renderer for one row. No result yet means the row shows what was asked
 * for (`pending`) rather than an empty version of what will come back.
 */
export function resolveToolRendererId(item: ToolActivityItem): ToolRendererId {
  if (!item.result) return item.status === 'running' ? 'pending' : 'none';
  return rendererForResultKind(item.result.kind);
}

const ICON_BY_ACTIVITY: Record<ToolActivityKind, AnthropiconName> = {
  computer: 'computer',
  read: 'file',
  search: 'search',
  websearch: 'globe',
  webfetch: 'link',
  edit: 'edit',
  command: 'terminal',
  explore: 'folderOpen',
  browser: 'cursorClick',
  tool: 'tool',
};

export function toolActivityIcon(kind: ToolActivityKind | undefined): AnthropiconName {
  return kind ? ICON_BY_ACTIVITY[kind] : 'tool';
}

/** The kind a row is treated as when the projection did not name one. */
export function toolActivityKindOf(item: ToolActivityItem): ToolActivityKind {
  return item.activityKind ?? 'tool';
}

export type ToolRowStatus = 'running' | 'completed' | 'errored' | 'interrupted' | 'sandbox_blocked';

export function toolRowStatus(item: ToolActivityItem): ToolRowStatus {
  if (isSandboxDeniedTool(item)) return 'sandbox_blocked';
  return toolActivityPresentationStatus(item);
}

/**
 * The row's one-line header.
 *
 * Computer Use is the exception the label module exists for: its tool name is
 * a noun, so every call would read the same. Everything else prefers the
 * bounded invocation line the quiet preview formats from the call's own
 * arguments, and falls back to the tool's display name.
 */
export function toolRowTitle(item: ToolActivityItem, locale: UiLocale): string {
  if (isComputerTool(item)) {
    return computerActionLabel(item, locale) ?? resolveToolDisplayName(item, locale);
  }
  const invocation = formatToolInvocationLine(item, locale);
  if (invocation && invocation.trim().length > 0) return invocation;
  return resolveToolDisplayName(item, locale);
}

/** The header's trailing note: the outcome in a word, when there is one to say. */
export function toolRowStatusLabel(item: ToolActivityItem, locale: UiLocale): string | undefined {
  const copy = getToolActivityCopy(locale);
  const status = toolRowStatus(item);
  if (status === 'sandbox_blocked') return getTranscriptCopy(locale).sandbox.blockedLabel;
  if (status === 'interrupted') return copy.status.interrupted;
  if (status === 'errored') return copy.errorLabel;
  return undefined;
}

/**
 * Whether opening the row shows anything the header did not already say.
 *
 * A running row is expandable so streamed output is reachable while it
 * arrives; `none` and `file_write` are not, because their whole content is the
 * header line.
 */
export function canExpandTool(item: ToolActivityItem): boolean {
  const renderer = resolveToolRendererId(item);
  if (renderer === 'none') return false;
  if (renderer === 'file_write') return false;
  if (renderer === 'pending') {
    return (item.outputChunks?.length ?? 0) > 0 || item.args !== undefined;
  }
  return true;
}

interface SummaryBucket {
  readonly kind: ToolActivityKind;
  readonly index: number;
  count: number;
}

/** How many phrases a group summary is allowed to name before it stops. */
export const TOOL_SUMMARY_MAX_PHRASES = 3;

/**
 * A tool group's collapsed header.
 *
 * Counted by activity kind and ordered by how many calls each kind holds, then
 * by first appearance — a 40-step turn reads "Ran 22 commands, read 16 files"
 * rather than opening with whichever kind happened to go first. Only the top
 * few phrases survive: the header is one line wide and a full enumeration is
 * several.
 */
export function summarizeToolGroup(items: readonly ToolActivityItem[], locale: UiLocale): string {
  const copy = getTranscriptCopy(locale).tools;
  const buckets = new Map<ToolActivityKind, SummaryBucket>();
  for (const item of items) {
    const kind = toolActivityKindOf(item);
    const existing = buckets.get(kind);
    if (existing) existing.count += 1;
    else buckets.set(kind, { kind, index: buckets.size, count: 1 });
  }
  if (buckets.size === 0) return copy.working;
  const phrases = [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .slice(0, TOOL_SUMMARY_MAX_PHRASES)
    .map((bucket) => {
      const label = copy.summary[bucket.kind];
      return bucket.count > 1 ? label.other(bucket.count) : label.one;
    });
  return copy.join(phrases);
}

/** What the group header says while its last row is still running. */
export function activeToolLabel(items: readonly ToolActivityItem[], locale: UiLocale): string {
  const copy = getTranscriptCopy(locale).tools;
  const running = [...items].reverse().find((item) => item.status === 'running');
  if (!running) return copy.working;
  if (isAskUserQuestionTool(running)) return copy.asking;
  return copy.active[toolActivityKindOf(running)];
}
