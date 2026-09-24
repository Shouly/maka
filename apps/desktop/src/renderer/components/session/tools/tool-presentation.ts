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

import type { ToolActivityKind, ToolFailureKind } from '@maka/core/events';
import type { UiLocale } from '@maka/core/ui-locale';
import { TOOL_NAMES } from '@maka/core/tool-names';
import {
  computerActionLabel,
  formatToolInvocationLine,
  getToolActivityCopy,
  isComputerTool,
  toolFailureOf,
  describeToolSearchCall,
  isConnectorTool,
  resolveToolDisplayName,
  toolActivityPresentationStatus,
  type ToolActivityItem,
  type ToolFailurePresentation,
} from '@maka/ui';
import type { AnthropiconName } from '../../icons/Anthropicon.js';
import { getTranscriptCopy, type ToolStepVerbKey } from '../../../locales/transcript-copy.js';
import { isAskUserQuestionTool } from '../../../lib/ask-user-question.js';
import {
  durableResultOf,
  isScheduledTaskWriteItem,
  readGlobResult,
  readGrepResult,
  readUserFileDelivery,
  type DurableToolResultKind,
} from '../../../lib/tool-delivery-results.js';
import { toolRowDescription } from '../../../lib/tool-row-description.js';
import {
  isMemorySoftConflict,
  isMemoryTool,
  memoryBasename,
  memoryBreadcrumb,
  memoryCanExpand,
  memoryPathsOf,
  memoryResultText,
  memoryToolVerb,
  parseMemoryListResult,
} from '../../../lib/memory-tool-results.js';

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
  | 'scheduled_task'
  | 'grep'
  | 'glob'
  | 'tool_search'
  | 'memory'
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
    // A delivered message is prose of the turn, never a row's body
    // (`groupTurnTimeline`), so the kind has nothing to open.
    case 'user_message':
      return 'none';
  }
}

/**
 * The renderer for one row. No result yet means the row shows what was asked
 * for (`pending`) rather than an empty version of what will come back.
 */
export function resolveToolRendererId(item: ToolActivityItem): ToolRendererId {
  // A scheduled task the turn just created or changed is a THING the person now
  // owns, not a step of the work — it gets a card that names it and opens it,
  // the way the reference does, rather than a row whose result they must read.
  if (isScheduledTaskWriteItem(item)) return 'scheduled_task';
  // The discovery connector is decided by which tool it is, like the two above
  // and for the same reason: its result is a list of names that only means
  // anything as "these are now usable", which the row says in one line. The
  // reference gives it a renderer of its own with no body at all.
  if (isConnectorTool(item.toolName)) return 'tool_search';
  // The memory family is decided by name too: six tools, one icon, one body
  // shape per verb, and results that are plain text to the model — the text
  // renderer would show the reader the version handshake.
  if (isMemoryTool(item)) return 'memory';
  // A failed row whose whole result IS the error text has already shown it:
  // the failure block carries that text, labelled and graded. Rendering the
  // text body underneath says the same sentence twice — once designed, once as
  // anonymous monospace — because both come from the one string the runtime
  // wrote. When the body has more than the envelope could keep (a memory
  // refusal returns the file's current content so the model can merge), they
  // are different things and both belong.
  if (failureMessageIsTheWholeResult(item)) return 'none';
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

/**
 * Whether the result body would only repeat the failure's reason.
 *
 * A string comparison, and deliberately not an inference: it asks "are these
 * the same words", never "what kind of failure is this". The second question
 * is the envelope's job, and guessing it from prose is what `memoryErrorKind`
 * did before it was deleted.
 */
function failureMessageIsTheWholeResult(item: ToolActivityItem): boolean {
  const message = toolRowFailure(item)?.message;
  if (!message) return false;
  const result = durableResultOf(item);
  if (result?.kind !== 'text' && result?.kind !== 'summary') return false;
  const body = (result.kind === 'text' ? result.text : result.summarized).trim();
  // One direction only. "The body adds nothing" means the REASON already holds
  // all of it — never the other way round, which is the case where the body
  // holds more and both belong. The envelope is capped at 512 characters and
  // the body runs to 4000, so reading it the other way suppressed a 832-
  // character error the moment its first 511 characters matched, taking the
  // actual cause at its tail with it.
  const reason = message.replace(/\u2026$/u, '').trim();
  if (!reason) return false;
  return reason.startsWith(body);
}

const ICON_BY_ACTIVITY: Record<ToolActivityKind, AnthropiconName> = {
  computer: 'computer',
  read: 'file',
  search: 'search',
  websearch: 'globe',
  webfetch: 'globe',
  edit: 'edit',
  command: 'terminal',
  explore: 'folderOpen',
  browser: 'cursorClick',
  tasks: 'tasks',
  delegate: 'agent',
  schedule: 'clock',
  tool: 'tool',
};

export function toolActivityIcon(kind: ToolActivityKind | undefined): AnthropiconName {
  return kind ? ICON_BY_ACTIVITY[kind] : 'tool';
}

/**
 * The glyph that marks a failed row, in place of the word "Error".
 *
 * Three marks for three grades, from the families the icon set already draws
 * the distinction in: the prohibition sign for a rule that said no, a lock for
 * a boundary that can be opened, and the circled exclamation the rest of the
 * terminal states use for something that broke.
 */
const MARK_BY_FAILURE: Readonly<Record<ToolFailureKind, AnthropiconName>> = {
  refused: 'prohibit',
  denied: 'lock',
  failed: 'warningCircle',
};

export function toolFailureMark(failure: ToolFailurePresentation): AnthropiconName {
  return MARK_BY_FAILURE[failure.kind];
}

/**
 * Tools whose glyph the reference draws differently from their activity kind.
 *
 * Two tables, because two populations ask the question. A tool this app has
 * never heard of — an MCP or plugin tool, named at runtime — can only say which
 * KIND of work it is doing (`mcp-tools.ts` maps a descriptor to one), so
 * `ICON_BY_ACTIVITY` is the only answer available for it. A tool the app ships
 * can be drawn as itself, and the reference does: `create_file` is a page and
 * `str_replace` a pencil, though both are `edit` here.
 *
 * So the kind is the rule for a category and this is the exception for a name —
 * and the kind must STAY coarse, because the same field buckets the collapsed
 * summary, where Write and Edit belong in one phrase ("Edited 3 files"). One
 * knob cannot be both, which is why keying the icon off the kind alone put a
 * pencil on Write and a plain page on Read.
 *
 * Every row here is a real disagreement; a row that merely restates its kind
 * belongs in `ICON_BY_ACTIVITY` instead.
 */
const ICON_OVERRIDE_BY_TOOL: Readonly<Record<string, AnthropiconName>> = {
  [TOOL_NAMES.write]: 'note',
  [TOOL_NAMES.read]: 'code',
  [TOOL_NAMES.toolSearch]: 'connectors',
  [TOOL_NAMES.skill]: 'scroll',
  [TOOL_NAMES.sendUserFile]: 'file',
};

export function toolRowIcon(item: ToolActivityItem): AnthropiconName {
  const override = ICON_OVERRIDE_BY_TOOL[item.toolName];
  if (override) return override;
  if (isMemoryTool(item)) return 'memory';
  // Asked by the same predicate the summary asks, and for the same reason: a
  // live question is not named, so a table keyed on the name would leave the row
  // generic for the whole wait and flip the moment it settled.
  if (isAskUserQuestionTool(item)) return 'questionCircle';
  return toolActivityIcon(toolActivityKindOf(item));
}

/** The kind a row is treated as when the projection did not name one. */
export function toolActivityKindOf(item: ToolActivityItem): ToolActivityKind {
  return item.activityKind ?? 'tool';
}

export type ToolRowStatus = 'running' | 'completed' | 'errored' | 'interrupted';

/**
 * The row's lifecycle, and only that.
 *
 * `sandbox_blocked` used to live here as a fifth state, which made the sandbox
 * the one failure the row could describe and every other failure a bare
 * `errored`. What KIND of failure it was is `toolFailureOf`'s answer now, and
 * it answers for all of them.
 */
export function toolRowStatus(item: ToolActivityItem): ToolRowStatus {
  // A memory version conflict is the model's routine merge-and-retry, not an
  // error the reader should see at all; the row keeps its verb and says
  // "merging" beside it (`toolRowStatusLabel`).
  if (isMemorySoftConflict(item)) return 'completed';
  return toolActivityPresentationStatus(item);
}

/**
 * The failure a row is showing, if any — the single question the header, the
 * body, the group summary and the turn banner all ask.
 *
 * A soft memory conflict is filtered out here too, so it cannot be graded as a
 * failure by one caller and as a success by another.
 */
export function toolRowFailure(item: ToolActivityItem): ToolFailurePresentation | undefined {
  return isMemorySoftConflict(item) ? undefined : toolFailureOf(item);
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
  const tense = toolRowTense(item);
  switch (item.toolName) {
    case TOOL_NAMES.taskCreate:
      return tense === 'running'
        ? copy.creating
        : tense === 'done'
          ? copy.created
          : copy.attempted.create;
    case TOOL_NAMES.taskUpdate:
      return tense === 'running'
        ? copy.updating
        : tense === 'done'
          ? copy.updated
          : copy.attempted.update;
    case TOOL_NAMES.taskGet: {
      const taskId = taskIdArg(item);
      return tense === 'running'
        ? copy.fetching(taskId)
        : tense === 'done'
          ? copy.fetched(taskId)
          : copy.attempted.fetch(taskId);
    }
    case TOOL_NAMES.taskList:
      return tense === 'running'
        ? copy.listing
        : tense === 'done'
          ? copy.listed
          : copy.attempted.list;
    default:
      return undefined;
  }
}

/**
 * Which of the three forms a row's title takes.
 *
 * `done` is the only one that may assert an outcome, and a row earns it by
 * settling WITHOUT failing and without being cut short. This is the rule that
 * used to be `running ? present : past`, under which a refused TaskUpdate read
 * "Task updated" — in red, beside the refusal that stopped it.
 */
type ToolRowTense = 'running' | 'done' | 'attempted';

function toolRowTense(item: ToolActivityItem): ToolRowTense {
  const status = toolRowStatus(item);
  if (status === 'running') return 'running';
  return status === 'completed' ? 'done' : 'attempted';
}

/** TaskGet names its target in the header; the id is the only arg worth reading. */
function taskIdArg(item: ToolActivityItem): string | undefined {
  const args = item.args;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
  const taskId = (args as Record<string, unknown>).taskId;
  return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : undefined;
}

/**
 * A memory row says what it did to which file: "Read food.md", "Saved
 * profile.md". The six tools share one icon, so the verb is what tells them
 * apart, and the name is the file's — the path itself goes to the trailing
 * breadcrumb (`toolRowMeta`). A soft conflict keeps the present tense: nothing
 * was saved yet, and "Saved x" over an unlanded write would be a lie.
 */
function memoryRowTitle(item: ToolActivityItem, locale: UiLocale): string | undefined {
  const verb = memoryToolVerb(item.toolName);
  if (!verb) return undefined;
  const copy = getTranscriptCopy(locale).tools.memory;
  const paths = memoryPathsOf(item);
  const name =
    paths.length > 1 ? copy.files(paths.length) : paths[0] ? memoryBasename(paths[0]) : undefined;
  // A soft conflict is not settled: nothing was written yet, and "Saved x"
  // over an unlanded write would be a lie in the other direction.
  const tense = isMemorySoftConflict(item) ? 'running' : toolRowTense(item);
  switch (verb) {
    case 'search':
      return tense === 'running'
        ? copy.searching
        : tense === 'done'
          ? copy.searched
          : copy.attempted.search;
    case 'read':
      return tense === 'running'
        ? copy.reading(name)
        : tense === 'done'
          ? copy.read(name)
          : copy.attempted.read(name);
    case 'save':
      return tense === 'running'
        ? copy.saving(name)
        : tense === 'done'
          ? copy.saved(name)
          : copy.attempted.save(name);
    case 'update':
      return tense === 'running'
        ? copy.updating(name)
        : tense === 'done'
          ? copy.updated(name)
          : copy.attempted.update(name);
    case 'delete':
      return tense === 'running'
        ? copy.deleting(name)
        : tense === 'done'
          ? copy.deleted(name)
          : copy.attempted.delete(name);
  }
}

export function toolRowTitle(item: ToolActivityItem, locale: UiLocale): string {
  if (isComputerTool(item)) {
    return computerActionLabel(item, locale) ?? resolveToolDisplayName(item, locale);
  }
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
  const memory = memoryRowTitle(item, locale);
  if (memory) return memory;
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
  if (isMemorySoftConflict(item)) return getTranscriptCopy(locale).tools.memory.merging;
  // A background command inherited from another session says so, and which of
  // the two it is: still running over there, or out of sight. Ahead of the
  // interruption word because `lost` IS reported as an interruption — "已中断"
  // would say the command stopped, when what stopped is our view of it.
  const inherited = getTranscriptCopy(locale).inheritedRun;
  if (item.shellRunSource === 'unavailable') return inherited.lost;
  if (item.shellRunSource === 'owned') return inherited.elsewhere;
  // A failure is marked with a glyph, not with the word "error" — see
  // `toolRowFailure`. An interruption keeps its word: there is no glyph for
  // "you stopped this", and it is not a failure to grade.
  return toolRowStatus(item) === 'interrupted' ? copy.status.interrupted : undefined;
}

/**
 * The header's trailing detail, before the status word: where in memory a row
 * looked, and how many files a listing found. The title carries the file's
 * name; this carries the rest of the path as a breadcrumb, which is how the
 * reference draws it.
 */
export function toolRowMeta(item: ToolActivityItem, locale: UiLocale): string | undefined {
  const verb = memoryToolVerb(item.toolName);
  if (!verb || toolRowFailure(item)) return undefined;
  const copy = getTranscriptCopy(locale).tools.memory;
  const paths = memoryPathsOf(item);
  const parts: string[] = [];
  if (paths.length === 1) parts.push(memoryBreadcrumb(paths[0]!));
  if (verb === 'search' && item.status === 'completed') {
    const count = parseMemoryListResult(memoryResultText(item)).length;
    if (count > 0) parts.push(copy.files(count));
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * Whether opening the row shows anything the header did not already say.
 *
 * A running row is expandable so streamed output is reachable while it
 * arrives; `none` and `file_write` are not, because their whole content is the
 * header line.
 */
export function canExpandTool(item: ToolActivityItem): boolean {
  // A failed row always opens. The reason is the one thing it has to show, and
  // before this it was the one thing it could not: live, the Host omits the
  // result body, so the renderer resolved to `none` and the row that had just
  // stopped being watchable also stopped being openable — with the streamed
  // output still sitting on the item, unreachable until the turn ended.
  if (toolRowFailure(item)) return true;
  const renderer = resolveToolRendererId(item);
  if (renderer === 'none') return false;
  if (renderer === 'file_write') return false;
  // A delivered file is a card at the foot of the turn (`groupTurnTimeline`);
  // its step says it was shared, and opening it would draw the card twice.
  if (renderer === 'user_file_delivery') return false;
  if (renderer === 'scheduled_task') return false;
  // A search has no body: the row names what was asked, and what it found is
  // already usable. Opening it would show a list of names twice.
  if (renderer === 'tool_search') return false;
  if (renderer === 'memory') return memoryCanExpand(item);
  // A call with no result yet — `pending` means running and unanswered — can be
  // opened for as long as it is live, and nothing about the row may decide that
  // twice. Keyed on what the row knows so far, the header is a div until the
  // first argument key closes and a button after: React rebuilds the subtree at
  // that moment and the sweep restarts in the middle of the run. `PendingResult`
  // already draws the interval before the arguments say anything.
  if (renderer === 'pending') return true;
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
export type ToolSummaryKey =
  | ToolActivityKind
  | 'ask'
  | 'taskRead'
  | 'toolSearch'
  | 'share'
  | 'memorySearch'
  | 'memoryRead'
  | 'memorySave'
  | 'memoryUpdate'
  | 'memoryDelete';

const MEMORY_SUMMARY_KEYS = {
  search: 'memorySearch',
  read: 'memoryRead',
  save: 'memorySave',
  update: 'memoryUpdate',
  delete: 'memoryDelete',
} as const satisfies Record<NonNullable<ReturnType<typeof memoryToolVerb>>, ToolSummaryKey>;

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
  // A delivered file is handed over, not worked on — "Created a file, shared a
  // file" is how the reference's summary says it.
  if (item.toolName === TOOL_NAMES.sendUserFile) return 'share';
  // Not an activity kind: only the request registry recognises a question while
  // it is still being asked, because the live row has no tool name.
  if (isAskUserQuestionTool(item)) return 'ask';
  // Memory gets a phrase per verb, and the verbs merge onto one object in the
  // summary — "Searched, read, and updated memory" — rather than counting as
  // files read and files edited, which is what their activity kinds say.
  const memory = memoryToolVerb(item.toolName);
  if (memory) return MEMORY_SUMMARY_KEYS[memory];
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
    // A delivered message is prose and never reaches a run; one still here
    // failed, and is counted like any other call — skipping it left a run of
    // nothing else summarised as "Working on it…" for good.
    const key = toolSummaryKeyOf(item);
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { key, index: buckets.size, count: 1 });
  }
  if (buckets.size === 0) return copy.working;
  // Labels that share an object merge into one phrase, the object said once:
  // a turn that searched, read and updated memory reads "Searched, read, and
  // updated memory", not three phrases each ending in "memory". A lone verb
  // keeps its own label, which is where a count lives when one is spoken.
  const groups: { readonly object?: string; readonly index: number; entries: SummaryBucket[] }[] =
    [];
  for (const bucket of buckets.values()) {
    const object = copy.summary[bucket.key].merge?.object;
    const group = object ? groups.find((candidate) => candidate.object === object) : undefined;
    if (group) group.entries.push(bucket);
    else groups.push({ ...(object ? { object } : {}), index: bucket.index, entries: [bucket] });
  }
  const steps = (group: (typeof groups)[number]) =>
    group.entries.reduce((total, entry) => total + entry.count, 0);
  const ordered = groups.sort(
    (left, right) => steps(right) - steps(left) || left.index - right.index,
  );
  const phrases = ordered.slice(0, TOOL_SUMMARY_MAX_PHRASES).map((group) => {
    if (group.object && group.entries.length > 1) {
      const verbs = [...new Set(group.entries.map((entry) => copy.summary[entry.key].merge!.verb))];
      return copy.joinMerged(verbs, group.object);
    }
    const bucket = group.entries[0]!;
    const label = copy.summary[bucket.key];
    // The count is still what ORDERS the phrases; whether it is spoken is
    // the label's own business. `other` exists for the kinds that count an
    // object — "Read 16 files" — and the task labels deliberately read the
    // same at any count, as the reference's do.
    return bucket.count > 1 ? label.other(bucket.count) : label.one;
  });
  // What the named phrases leave out is counted in steps, the reference's
  // "Used 13 tools, updated tasks, and 3 more steps".
  const rest = ordered
    .slice(TOOL_SUMMARY_MAX_PHRASES)
    .reduce((sum, group) => sum + steps(group), 0);
  return rest > 0 ? copy.moreSteps(copy.join(phrases), rest) : copy.join(phrases);
}

/**
 * What the transcript's status line says while a call is in flight.
 *
 * A call the MODEL labelled says what it is doing; the generic phrase is the
 * fallback for the calls that cannot. Bash and Agent are the two tools that
 * carry a `description` written for a reader, and "Running the renderer
 * typecheck" is worth more under the transcript than "Running a command" —
 * which was the same sentence for every command in the session.
 *
 * The same rule Computer Use already got: `deriveTurnActivity` lets a running
 * computer action name its target ahead of the generic phrase. This extends it
 * to the other two families that can name themselves rather than leaving it a
 * one-family exception.
 */
export function activeToolLabel(items: readonly ToolActivityItem[], locale: UiLocale): string {
  const copy = getTranscriptCopy(locale).tools;
  const running = [...items].reverse().find((item) => item.status === 'running');
  if (!running) return copy.working;
  return toolRowDescription(running) ?? copy.active[toolSummaryKeyOf(running)];
}

// ── Step labels ─────────────────────────────────────────────────────────────

/**
 * A step row's words, the reference's `{ verb, meta }`: a muted lead, then the
 * object it acted on in primary ink. A row has no icon, so the verb is its
 * identity; a call that names itself (a Bash or Agent `description`) is its
 * own lead and has no object.
 */
export interface ToolStepLabel {
  readonly lead: string;
  readonly object?: string;
  /** A command, a pattern or a skill name: drawn as code. */
  readonly objectIsCode?: boolean;
  /** Muted detail after the object — where in memory, how many files. */
  readonly detail?: string;
  /** The whole line as one string, for the tooltip and the live status row. */
  readonly text: string;
}

type StepTense = 'running' | 'done' | 'failed';

function stepTense(item: ToolActivityItem): StepTense {
  // A soft memory conflict is the model merging before it writes: nothing has
  // landed, so it keeps the running form.
  if (isMemorySoftConflict(item)) return 'running';
  if (toolRowFailure(item)) return 'failed';
  // An interrupted call keeps the form of what it was doing; the row's status
  // word says it stopped.
  return toolRowStatus(item) === 'completed' ? 'done' : 'running';
}

function argsRecordOf(item: ToolActivityItem): Record<string, unknown> | undefined {
  const args = item.args ?? item.argsPreview;
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined;
}

function stringArgOf(item: ToolActivityItem, key: string): string | undefined {
  const value = argsRecordOf(item)?.[key];
  if (typeof value !== 'string') return undefined;
  const flattened = value.replace(/\s+/gu, ' ').trim();
  return flattened || undefined;
}

function basenameOf(path: string): string {
  return path.split(/[/\\]/u).filter(Boolean).pop() ?? path;
}

/** The file a file tool acted on, by name; several become a count. */
function fileObjectOf(
  item: ToolActivityItem,
  files: (count: number) => string,
): string | undefined {
  const named =
    stringArgOf(item, 'file_path') ??
    stringArgOf(item, 'notebook_path') ??
    stringArgOf(item, 'path');
  if (named) return basenameOf(named);
  const result = durableResultOf(item);
  const paths =
    result?.kind === 'file_diff'
      ? result.paths
      : result?.kind === 'file_write'
        ? [result.path]
        : [];
  if (paths.length > 1) return files(paths.length);
  return paths[0] ? basenameOf(paths[0]) : undefined;
}

/** TaskUpdate's verb follows the status it set, as the reference's does. */
function taskUpdateVerbOf(item: ToolActivityItem): ToolStepVerbKey {
  switch (stringArgOf(item, 'status')) {
    case 'completed':
      return 'taskComplete';
    case 'in_progress':
      return 'taskStart';
    case 'pending':
      return 'taskReset';
    case 'deleted':
      return 'taskRemove';
    default:
      return 'taskUpdate';
  }
}

function taskRefOf(item: ToolActivityItem): string | undefined {
  const id = stringArgOf(item, 'taskId');
  return id ? `#${id}` : undefined;
}

/** One question is named; several are counted. */
function askObjectOf(
  item: ToolActivityItem,
  questions: (count: number) => string,
): string | undefined {
  const list = argsRecordOf(item)?.questions;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  if (list.length > 1) return questions(list.length);
  const first = list[0];
  const text =
    typeof first === 'object' && first !== null
      ? (first as Record<string, unknown>).question
      : undefined;
  return typeof text === 'string' && text.trim() ? text.replace(/\s+/gu, ' ').trim() : undefined;
}

function sharedFilesObjectOf(
  item: ToolActivityItem,
  files: (count: number) => string,
): string | undefined {
  const delivered = readUserFileDelivery(durableResultOf(item))?.files;
  if (delivered && delivered.length > 0) {
    return delivered.length > 1 ? files(delivered.length) : delivered[0]!.name;
  }
  const asked = argsRecordOf(item)?.files;
  if (!Array.isArray(asked) || asked.length === 0) return undefined;
  if (asked.length > 1) return files(asked.length);
  return typeof asked[0] === 'string' ? basenameOf(asked[0]) : undefined;
}

const MEMORY_STEP_VERBS = {
  search: 'memorySearch',
  read: 'read',
  save: 'memorySave',
  update: 'memoryUpdate',
  delete: 'memoryDelete',
} as const satisfies Record<NonNullable<ReturnType<typeof memoryToolVerb>>, ToolStepVerbKey>;

export function toolStepLabel(item: ToolActivityItem, locale: UiLocale): ToolStepLabel {
  const copy = getTranscriptCopy(locale).tools;
  const tense = stepTense(item);
  const verb = (key: ToolStepVerbKey): string => copy.step.verbs[key][tense];
  const label = (
    lead: string,
    object?: string,
    options: { code?: boolean; detail?: string } = {},
  ): ToolStepLabel => ({
    lead,
    ...(object ? { object } : {}),
    ...(object && options.code ? { objectIsCode: true } : {}),
    ...(options.detail ? { detail: options.detail } : {}),
    text: [lead, object, options.detail].filter(Boolean).join(' '),
  });

  switch (item.toolName) {
    case TOOL_NAMES.bash: {
      const described = toolRowDescription(item);
      if (described) return label(described);
      const command = stringArgOf(item, 'command');
      return command
        ? label(verb('command'), command, { code: true })
        : label(verb('command'), copy.step.aCommand);
    }
    case TOOL_NAMES.agent:
      return label(toolRowDescription(item) ?? verb('agent'));
    case TOOL_NAMES.read:
      return label(verb('read'), fileObjectOf(item, copy.step.files));
    case TOOL_NAMES.write: {
      const result = durableResultOf(item);
      const updated = result?.kind === 'file_write' && result.created === false;
      return label(verb(updated ? 'update' : 'create'), fileObjectOf(item, copy.step.files));
    }
    case TOOL_NAMES.edit:
    case TOOL_NAMES.notebookEdit:
    case TOOL_NAMES.applyPatch:
      return label(verb('edit'), fileObjectOf(item, copy.step.files));
    case TOOL_NAMES.grep:
    case TOOL_NAMES.glob:
      return label(verb('search'), stringArgOf(item, 'pattern'), { code: true });
    case TOOL_NAMES.webFetch:
      return label(verb('fetch'), stringArgOf(item, 'url'));
    case TOOL_NAMES.webSearch:
      return label(verb('webSearch'), stringArgOf(item, 'query'));
    case TOOL_NAMES.skill: {
      const skill = stringArgOf(item, 'skill');
      return label(verb('skill'), skill ? `/${skill}` : undefined, { code: true });
    }
    case TOOL_NAMES.taskCreate:
      return label(verb('taskAdd'), stringArgOf(item, 'subject'));
    case TOOL_NAMES.taskUpdate:
      return label(verb(taskUpdateVerbOf(item)), stringArgOf(item, 'subject') ?? taskRefOf(item));
    case TOOL_NAMES.taskGet:
      return label(verb('taskGet'), taskRefOf(item));
    case TOOL_NAMES.taskList:
      return label(verb('taskList'));
    case TOOL_NAMES.taskStop:
      return label(verb('taskStop'), stringArgOf(item, 'task_id') ?? stringArgOf(item, 'taskId'));
    case TOOL_NAMES.sendUserFile:
      return label(verb('share'), sharedFilesObjectOf(item, copy.step.files));
    case TOOL_NAMES.sendUserMessage:
      return label(verb('message'));
  }
  if (isComputerTool(item)) {
    return label(computerActionLabel(item, locale) ?? resolveToolDisplayName(item, locale));
  }
  // Asked by the request registry as well as by name: a live question's row has
  // no tool name yet.
  if (isAskUserQuestionTool(item))
    return label(verb('ask'), askObjectOf(item, copy.step.questions));
  if (isConnectorTool(item.toolName)) return label(verb('toolSearch'));
  const memory = memoryToolVerb(item.toolName);
  if (memory) {
    const paths = memoryPathsOf(item);
    const name =
      memory === 'search'
        ? undefined
        : paths.length > 1
          ? copy.memory.files(paths.length)
          : paths[0]
            ? memoryBasename(paths[0])
            : undefined;
    const detail = toolRowMeta(item, locale);
    return label(verb(MEMORY_STEP_VERBS[memory]), name, detail ? { detail } : {});
  }
  // Everything else — MCP and plugin tools, goals, scheduled-task reads,
  // research steps — names itself through the invocation line.
  return label(toolRowTitle(item, locale));
}
