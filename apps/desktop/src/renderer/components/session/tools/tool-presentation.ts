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

import type { ToolActivityKind } from '@maka/core/events';
import type { UiLocale } from '@maka/core/ui-locale';
import { TOOL_NAMES } from '@maka/core/tool-names';
import {
  computerActionLabel,
  formatToolInvocationLine,
  getToolActivityCopy,
  isComputerTool,
  isSandboxDeniedTool,
  describeToolSearchCall,
  isConnectorTool,
  resolveToolDisplayName,
  toolActivityPresentationStatus,
  type ToolActivityItem,
} from '@maka/ui';
import type { AnthropiconName } from '../../icons/Anthropicon.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { isAskUserQuestionTool } from '../../../lib/ask-user-question.js';
import {
  durableResultOf,
  isNoteItem,
  isScheduledTaskWriteItem,
  readNoteMessage,
  readGlobResult,
  readGrepResult,
  type DurableToolResultKind,
} from '../../../lib/tool-delivery-results.js';
import { toolRowDescription } from '../../../lib/tool-row-description.js';

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
  | 'user_file_delivery'
  | 'user_message'
  | 'scheduled_task'
  | 'grep'
  | 'glob'
  | 'tool_search'
  | 'pending'
  | 'none';

/**
 * The renderer for a result, by its kind alone.
 *
 * Exhaustive over `ToolResultContent` on purpose: a kind added to the runtime
 * makes this fail to compile rather than reaching a user as a blank row.
 */
export function rendererForResultKind(kind: DurableToolResultKind): ToolRendererId {
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
    case 'user_file_delivery':
      return 'user_file_delivery';
    case 'user_message':
      return 'user_message';
  }
}

/**
 * The renderer for one row. No result yet means the row shows what was asked
 * for (`pending`) rather than an empty version of what will come back.
 */
export function resolveToolRendererId(item: ToolActivityItem): ToolRendererId {
  // A note is decided by which tool it is, not by whether its result has
  // landed: live, the message is already in the args preview, and falling
  // back to `pending` here is what used to draw a generic tool row over the
  // one thing the call exists to show.
  if (isNoteItem(item)) return 'user_message';
  // A scheduled task the turn just created or changed is a THING the person now
  // owns, not a step of the work — it gets a card that names it and opens it,
  // the way the reference does, rather than a row whose result they must read.
  if (isScheduledTaskWriteItem(item)) return 'scheduled_task';
  // The discovery connector is decided by which tool it is, like the two above
  // and for the same reason: its result is a list of names that only means
  // anything as "these are now usable", which the row says in one line. The
  // reference gives it a renderer of its own with no body at all.
  if (isConnectorTool(item.toolName)) return 'tool_search';
  const result = durableResultOf(item);
  if (!result) return item.status === 'running' ? 'pending' : 'none';
  // Read, Grep and Glob hand the model plain text and keep a STRUCTURED
  // durable result, which reaches the renderer wrapped as `json`. Their
  // renderer is decided by that structure, not by the tool's name — the same
  // rule the rest of this registry runs on, so a proxied MCP search that
  // answers in the same shape gets the same list panel. Read's `{ content }`
  // has no list in it and stays on the JSON renderer, as it is today.
  if (result.kind === 'json') {
    if (readGrepResult(result.value)) return 'grep';
    if (readGlobResult(result.value)) return 'glob';
  }
  return rendererForResultKind(result.kind);
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
  tasks: 'tasks',
  tool: 'tool',
};

export function toolActivityIcon(kind: ToolActivityKind | undefined): AnthropiconName {
  return kind ? ICON_BY_ACTIVITY[kind] : 'tool';
}

/**
 * The glyph a row wears.
 *
 * Normally the activity kind, which is what the tool said it was doing. The
 * discovery connector declares no kind — none fits "finding the others" — so
 * it falls back to the generic wrench every unclassified tool wears, which is
 * the one row it should not look like. It searches, and it wears the glass the
 * other searches wear.
 */
export function toolRowIcon(item: ToolActivityItem): AnthropiconName {
  if (isConnectorTool(item.toolName)) return ICON_BY_ACTIVITY.search;
  return toolActivityIcon(toolActivityKindOf(item));
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
/**
 * The four task tools share one icon, so the row's own words are what tell
 * them apart — and each says what it is doing before it says what it did.
 * A row is "running" until its result settles; the settled row keeps the past
 * tense so a finished group reads as a record rather than a to-do.
 */
function taskRowTitle(item: ToolActivityItem, locale: UiLocale): string | undefined {
  const copy = getTranscriptCopy(locale).tools.task;
  const running = toolRowStatus(item) === 'running';
  switch (item.toolName) {
    case TOOL_NAMES.taskCreate:
      return running ? copy.creating : copy.created;
    case TOOL_NAMES.taskUpdate:
      return running ? copy.updating : copy.updated;
    case TOOL_NAMES.taskGet: {
      const taskId = taskIdArg(item);
      return running ? copy.fetching(taskId) : copy.fetched(taskId);
    }
    case TOOL_NAMES.taskList:
      return running ? copy.listing : copy.listed;
    default:
      return undefined;
  }
}

/** TaskGet names its target in the header; the id is the only arg worth reading. */
function taskIdArg(item: ToolActivityItem): string | undefined {
  const args = item.args;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
  const taskId = (args as Record<string, unknown>).taskId;
  return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : undefined;
}

export function toolRowTitle(item: ToolActivityItem, locale: UiLocale): string {
  if (isComputerTool(item)) {
    return computerActionLabel(item, locale) ?? resolveToolDisplayName(item, locale);
  }
  // A note that stayed in the timeline is drawn as its own words: the row is
  // the whole of it, so a label saying one was sent would be a line of chrome
  // in place of the thing it describes. A note too big for a row never gets
  // here — it is a block of the turn (`groupTurnTimeline`).
  const note = readNoteMessage(item);
  if (note) return note.replace(/\s+/gu, ' ').trim();
  // A search reads as the question it asked, not as the generic invocation
  // line: `select:X` is an identifier, and a row that printed it raw would
  // make the reader parse a wire form.
  if (isConnectorTool(item.toolName)) {
    return describeToolSearchCall(item.args ?? item.argsPreview, locale);
  }
  // A call that says what it is FOR outranks a call that says what it runs:
  // Bash may carry a `description`, Agent must. The command and the prompt
  // are still one click away in the opened panel, which is where a reader who
  // wants the literal text goes anyway.
  const task = taskRowTitle(item, locale);
  if (task) return task;
  const described = toolRowDescription(item);
  if (described) return described;
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
  // A delivery is drawn as a block of the turn, not inside the step list
  // (`groupTurnTimeline`). The step that survives — SendUserMessage's — is one
  // line saying it happened; opening it would show the message a second time.
  if (renderer === 'user_file_delivery' || renderer === 'user_message') return false;
  if (renderer === 'scheduled_task') return false;
  // A search has no body: the row names what was asked, and what it found is
  // already usable. Opening it would show a list of names twice.
  if (renderer === 'tool_search') return false;
  if (renderer === 'pending') {
    return (item.outputChunks?.length ?? 0) > 0 || item.args !== undefined;
  }
  return true;
}

/**
 * What a group summary counts as one activity.
 *
 * Usually the activity kind. The task family is the exception the extra key
 * exists for: four tools sit behind one kind, because they share an icon — and
 * two of them only READ. Counting a TaskList under "Updated tasks" reports
 * work the turn did not do, so the summary splits where the kind does not.
 * The reference draws the same line, with one phrase per verb and no icon
 * split: `task_create`/`task_update` say "Updated tasks", `task_get`/
 * `task_list` say "Checked tasks".
 */
export type ToolSummaryKey = ToolActivityKind | 'taskRead' | 'toolSearch';

/** The two task tools that change nothing. */
const TASK_READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.taskList,
  TOOL_NAMES.taskGet,
]);

export function toolSummaryKeyOf(item: ToolActivityItem): ToolSummaryKey {
  // The discovery connector declares no kind, so it lands in the bucket every
  // unclassified tool lands in and a turn that only looked for tools reports
  // "called a tool". It gets a phrase of its own for the same reason the task
  // readers do: the summary has to say what the turn actually did.
  if (isConnectorTool(item.toolName)) return 'toolSearch';
  const kind = toolActivityKindOf(item);
  return kind === 'tasks' && TASK_READ_TOOL_NAMES.has(item.toolName) ? 'taskRead' : kind;
}

interface SummaryBucket {
  readonly key: ToolSummaryKey;
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
  const buckets = new Map<ToolSummaryKey, SummaryBucket>();
  for (const item of items) {
    // A note is not work, and the header counts it on its own — see
    // `TurnWorkGroup.notes`. Left in here it would land in the `tool` bucket
    // and report "Called a tool" for something that ran nothing.
    if (isNoteItem(item)) continue;
    const key = toolSummaryKeyOf(item);
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { key, index: buckets.size, count: 1 });
  }
  if (buckets.size === 0) return copy.working;
  const phrases = [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .slice(0, TOOL_SUMMARY_MAX_PHRASES)
    .map((bucket) => {
      const label = copy.summary[bucket.key];
      // The count is still what ORDERS the phrases; whether it is spoken is
      // the label's own business. `other` exists for the kinds that count an
      // object — "Read 16 files" — and the task labels deliberately read the
      // same at any count, as the reference's do.
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
  return copy.active[toolSummaryKeyOf(running)];
}
